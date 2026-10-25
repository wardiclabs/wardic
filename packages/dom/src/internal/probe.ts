/**
 * `ProbeDomLive` — the browser realization of `Probe`: measurement
 * (`getBoundingClientRect`), reactive viewport size, the `prefers-reduced-motion`
 * preference, and per-target resize/intersection observation streams.
 *
 * The writable Atoms (`viewport`, `prefersReducedMotion`) are pinned with
 * `keepAlive` and written through the
 * Environment's {@link AtomRegistry} captured at build time — the same registry
 * a consumer reads `Probe.viewport`/`Probe.prefersReducedMotion` from — so the
 * `make`/event path can update them without leaking an `AtomRegistry`
 * requirement into the `Probe` interface. The window `resize` and
 * `MediaQueryList` `change` listeners are the only writers, forked into the
 * layer's scope so they live exactly as long as the Layer.
 *
 * Per CONTEXT.md's **Shared source** contract, `observeResize` goes through core's
 * `SharedSource.byTarget`: one `ResizeObserver` per target, ref-counted — the observer is
 * constructed and `observe()`d on the first subscriber and `disconnect()`ed when the last
 * unsubscribes. `observeIntersection` is an **Input feed** (#318) making one `IntersectionObserver`
 * per subscriber, since each may ask its own root, margin and amount (#273, Motion's `viewport`).
 *
 * Observability (CONTEXT.md observability convention): core's `SharedSource` already
 * carries a `wardic.sharedSource.*` span + a debug-log on subscribe; the hot
 * `measure`/viewport-write paths stay quiet.
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import * as Probe from "@wardic/core/Probe"
import * as SharedSource from "@wardic/core/SharedSource"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { Atom, AtomRegistry } from "effect/reactivity"
import { requireGlobal } from "./require-global.ts"
import { makeScroll } from "./scroll.ts"

/** Map a `DOMRect`-like value onto the engine's portable {@link Bounds}. */
/** An `IntersectionObserver`'s init from the Probe's options: each left out when not given. */
const observerInit = (options: Probe.IntersectionOptions): IntersectionObserverInit => ({
  ...UndefinedOr.match(options.root as Element | Document | undefined, { onUndefined: () => ({}), onDefined: (root) => ({ root }) }),
  ...UndefinedOr.match(options.margin, { onUndefined: () => ({}), onDefined: (rootMargin) => ({ rootMargin }) }),
  ...UndefinedOr.match(options.amount, { onUndefined: () => ({}), onDefined: (threshold) => ({ threshold }) }),
})

const toBounds = (r: DOMRect): Probe.Bounds => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  top: r.top,
  right: r.right,
  bottom: r.bottom,
  left: r.left,
})

/**
 * Captures the Environment's {@link AtomRegistry} and adds the window's `resize` listener and
 * the media query's `change` listener in the layer scope; each is the sole writer of its Atom.
 * The `resize` listener writes `viewport` inside the event (ADR-0018, *Amendment (#45)*).
 * `Layer.effect` runs `make` in the layer's own scope (it `Exclude`s `Scope`),
 * which the shared helpers' `RcMap`s and the forked listeners need.
 */
const make = Effect.gen(function* () {
  // Client-only (ADR-0021, decision 7): the viewport below reads `window`.
  yield* requireGlobal("ProbeDomLive", "window")

  // The shared Environment registry — the one consumers read these atoms from.
  const registry = yield* AtomRegistry.AtomRegistry

  // --- viewport -----------------------------------------------------------
  // `keepAlive` pins the node so the value the resize listener writes survives
  // between reads (an idle node with no subscriber would be GC'd and re-init).
  const viewport = Atom.keepAlive(
    Atom.make<Probe.Viewport>({ width: window.innerWidth, height: window.innerHeight }),
  )
  // The window's "resize" listener is the only writer of `viewport`, and it writes inside the
  // event (ADR-0018, *Amendment (#45)*): a reader, the projection system's Resize block among
  // them, sees the new size within the dispatch, not a scheduler hop later, before the frame's
  // Measure pass. A forked Stream consumer would land a task after the event.
  const writeViewport = (): void => registry.set(viewport, { width: window.innerWidth, height: window.innerHeight })
  yield* Effect.acquireRelease(
    Effect.sync(() => window.addEventListener("resize", writeViewport)),
    () => Effect.sync(() => window.removeEventListener("resize", writeViewport)),
  )

  // --- prefersReducedMotion ----------------------------------------------
  // Guard `matchMedia` (absent in some headless environments): default false.
  const mql = Bool.match(Predicate.isFunction(window.matchMedia), {
    onTrue: () => Option.some(window.matchMedia("(prefers-reduced-motion: reduce)")),
    onFalse: () => Option.none<MediaQueryList>(),
  })
  const prefersReducedMotion = Atom.keepAlive(Atom.make(Option.exists(mql, (query) => query.matches)))
  if (Option.isSome(mql)) {
    // The MediaQueryList "change" event is the only writer of the Atom. Forked
    // into the layer scope; the finalizer removes the listener on teardown.
    yield* Effect.forkScoped(
      Stream.runForEach(
        Stream.fromEventListener<MediaQueryListEvent>(mql.value as unknown as Stream.EventListener<MediaQueryListEvent>, "change"),
        (ev) => Effect.sync(() => registry.set(prefersReducedMotion, ev.matches)),
      ),
    )
  }

  // --- observeResize ------------------------------------------------------
  // One ResizeObserver per target, ref-counted via `SharedSource.byTarget`. The
  // observer is constructed on the first subscriber; `Effect.addFinalizer`
  // disconnects it when the last subscriber's scope closes.
  const observeResize = yield* SharedSource.byTarget<Probe.Bounds>((target) =>
    Effect.succeed(
      Stream.callback<Probe.Bounds>((queue) =>
        Effect.gen(function* () {
          const el = target as Element
          const ro = new ResizeObserver(() => {
            Queue.offerUnsafe(queue, toBounds(el.getBoundingClientRect()))
          })
          ro.observe(el)
          yield* Effect.addFinalizer(() => Effect.sync(() => ro.disconnect()))
        })
      )
    )
  )

  // --- observeIntersection ------------------------------------------------
  // An Input feed (#318) with one IntersectionObserver per subscriber, against its options (#273,
  // Motion's `viewport`): the root (the viewport when none), the margin (`rootMargin`) and the amount
  // (`threshold`). Each report carries the entry.
  const observeIntersection =
    (target: unknown, options: Probe.IntersectionOptions = {}): InputFeed.InputFeed<Probe.Intersection> => (emit) => {
      const io = new IntersectionObserver(
        (entries) => Arr.forEach(entries, (entry) => emit({ intersecting: entry.isIntersecting, raw: entry })),
        observerInit(options),
      )
      io.observe(target as Element)
      return () => io.disconnect()
    }

  return Probe.Probe.of({
    // Hot path — intentionally unlogged/un-spanned.
    measure: (target) => Effect.sync(() => toBounds((target as Element).getBoundingClientRect())),
    viewport,
    prefersReducedMotion,
    // A container's scroll, set within its events (#234): `scroll.ts`.
    scroll: makeScroll(registry),
    observeResize,
    observeIntersection,
  })
})

/**
 * `Probe` Layer backed by the DOM. Requires the Environment's `AtomRegistry`
 * (the registry consumers read `viewport`/`prefersReducedMotion` from); `DomLive`
 * provides it via `AtomRegistry.layer`, as `testLayer` does. Built
 * with `Layer.effect` so `make` runs in the layer's scope — the shared helpers'
 * `RcMap`s and the forked listeners live for the layer's lifetime. Building it on a
 * server (no `window`) fails with the client-only error (ADR-0021, decision 7).
 */
export const ProbeDomLive: Layer.Layer<Probe.Probe, never, AtomRegistry.AtomRegistry> = Layer.effect(
  Probe.Probe,
)(make)
