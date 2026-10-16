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
 * Per CONTEXT.md's **Shared source** contract, `observeResize`/`observeIntersection`
 * go through {@link makeSharedByTarget}: one `ResizeObserver`/`IntersectionObserver`
 * per target, ref-counted — the observer is constructed and `observe()`d on the
 * first subscriber and `disconnect()`ed when the last unsubscribes.
 *
 * Observability (CONTEXT.md observability convention): the shared helpers already
 * carry a `wardic.dom.shared.*` span + a debug-log on subscribe; the hot
 * `measure`/viewport-write paths stay quiet.
 */
import * as Probe from "@wardic/core/Probe"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/reactivity"
import { requireGlobal } from "./require-global.ts"
import { makeSharedByTarget } from "./shared.ts"

/** Map a `DOMRect`-like value onto the engine's portable {@link Bounds}. */
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
 * Captures the Environment's {@link AtomRegistry} and forks the `resize` /
 * media-query `change` listeners into the layer scope; both are the sole writers
 * of their respective Atoms.
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
  // A forked window "resize" listener is the only writer of `viewport`.
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.fromEventListener<Event>(window as unknown as Stream.EventListener<Event>, "resize"),
      () => Effect.sync(() => registry.set(viewport, { width: window.innerWidth, height: window.innerHeight })),
    ),
  )

  // --- prefersReducedMotion ----------------------------------------------
  // Guard `matchMedia` (absent in some headless environments): default false.
  const mql = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined
  const prefersReducedMotion = Atom.keepAlive(Atom.make(mql?.matches ?? false))
  if (mql !== undefined) {
    // The MediaQueryList "change" event is the only writer of the Atom. Forked
    // into the layer scope; the finalizer removes the listener on teardown.
    yield* Effect.forkScoped(
      Stream.runForEach(
        Stream.fromEventListener<MediaQueryListEvent>(mql as unknown as Stream.EventListener<MediaQueryListEvent>, "change"),
        (ev) => Effect.sync(() => registry.set(prefersReducedMotion, ev.matches)),
      ),
    )
  }

  // --- observeResize ------------------------------------------------------
  // One ResizeObserver per target, ref-counted via makeSharedByTarget. The
  // observer is constructed on the first subscriber; `Effect.addFinalizer`
  // disconnects it when the last subscriber's scope closes.
  const observeResize = yield* makeSharedByTarget<Probe.Bounds>((target) =>
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
  // One IntersectionObserver per target, ref-counted via makeSharedByTarget.
  const observeIntersection = yield* makeSharedByTarget<boolean>((target) =>
    Effect.succeed(
      Stream.callback<boolean>((queue) =>
        Effect.gen(function* () {
          const el = target as Element
          const io = new IntersectionObserver((entries) => {
            for (const entry of entries) Queue.offerUnsafe(queue, entry.isIntersecting)
          })
          io.observe(el)
          yield* Effect.addFinalizer(() => Effect.sync(() => io.disconnect()))
        })
      )
    )
  )

  return Probe.Probe.of({
    // Hot path — intentionally unlogged/un-spanned.
    measure: (target) => Effect.sync(() => toBounds((target as Element).getBoundingClientRect())),
    viewport,
    prefersReducedMotion,
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
