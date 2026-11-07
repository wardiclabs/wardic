/**
 * `createScroll` (#518): in a module of its own, so it brings the `scroll` Feature only to an app that
 * reads a scroll, and on the pages that do (ADR-0067, *Amendments (#548, #518)*).
 *
 * @module
 */
import * as LiveValue from "@wardic/core/LiveValue"
import * as ScrollSource from "@wardic/core/ScrollSource"
import type * as ScrollOffset from "@wardic/dom/ScrollOffset"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { isServer } from "@solidjs/web"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import type { Feature } from "../../feature.ts"
import { scroll } from "../../features/scroll.ts"
import { serviceOf } from "../../gesture-features.ts"
import * as OwnerScope from "../../owner-scope.ts"
import { followAtom } from "./bridge.ts"
import { CLOSE_FAILED, SERVER_ZERO } from "./live-value.ts"
import { useBrought, useWardicRuntime } from "./provider.tsx"
import { CLIENT_ONLY, onSettledClientOnly } from "./solid-reactivity.ts"

/** What it brings (ADR-0067 decision 12): the `scroll` Feature, whatever its section has (#518). */
const SCROLL: ReadonlyArray<Feature> = [scroll]

/** An element, or an accessor of one, such as `() => box` for a ref: read once it's there. */
export type ElementSource = Element | Accessor<Element | undefined>

/** `createScroll`'s options, as Motion's `useScroll`'s. */
export interface ScrollOptions {
  /** The scrolling element, as an accessor of its ref: `() => box`. The page's scroll when left out. */
  readonly container?: ElementSource
  /** An element whose way through the container the progress reads, between the `offset`s. */
  readonly target?: ElementSource
  /**
   * Where the progress runs, as Motion's: each stop pairs an edge of the target with an edge of the
   * container, `["start end", "end start"]`, 0 at the first and 1 at the last. An edge is `start`,
   * `center` or `end`, a fraction, or a length. With a target, `["start start", "end end"]` by default.
   */
  // The DOM's syntax (`@wardic/dom/ScrollOffset`); with a target and none given, its `All`.
  readonly offset?: ScrollOffset.ScrollOffset
  /** The axis `target` and `offset` read: `"y"` (the default) or `"x"`. */
  readonly axis?: "x" | "y"
}

/** `createScroll`'s values, Motion's four, each an accessor. */
export interface ScrollValues {
  /** How far it's scrolled across, in pixels. */
  readonly scrollX: Accessor<number>
  /** How far it's scrolled down, in pixels. */
  readonly scrollY: Accessor<number>
  /** Its progress across, from 0 to 1: through its range, or, with a `target` or `offset`, through theirs. */
  readonly scrollXProgress: Accessor<number>
  /** Its progress down, from 0 to 1: through its range, or, with a `target` or `offset`, through theirs. */
  readonly scrollYProgress: Accessor<number>
}

const SCROLL_KEYS = ["scrollX", "scrollY", "scrollXProgress", "scrollYProgress"] as const
/** `createScroll`'s elements before the render has settled: none yet. */
const NOT_YET = { container: Option.none(), target: Option.none() } as const
const SERVER_SCROLL: ScrollValues = { scrollX: SERVER_ZERO, scrollY: SERVER_ZERO, scrollXProgress: SERVER_ZERO, scrollYProgress: SERVER_ZERO }

/** An element source read now: `None` for an accessor whose ref hasn't arrived. */
const elementOf = (source: ElementSource | undefined): Option.Option<Element | undefined> =>
  Bool.match(Predicate.isFunction(source), {
    onTrue: () => Option.fromUndefinedOr((source as Accessor<Element | undefined>)()),
    onFalse: () => Option.some(source as Element | undefined),
  })

/**
 * A scroll as values: `scrollX` and `scrollY`, how far it's scrolled, in pixels, and `scrollXProgress`
 * and `scrollYProgress`, from 0 to 1 through its range. The page's, or a `container`'s. With a
 * `target`, the progress is the target's way through, between two `offset`s, on `axis`. Each is set in
 * the scroll's own event, so a value derived from one paints in the frame that shows the scroll. A
 * `container` or `target` given as an accessor of a ref reads 0s until the ref is there. 0s on a
 * server. Motion's `useScroll`.
 *
 * @example
 * let box!: HTMLDivElement
 * const { scrollYProgress } = createScroll({ container: () => box })
 * <div ref={box}>…</div>
 * <w.div style={{ scaleX: scrollYProgress }} />
 * @see https://wardic.dev/reference/solid/live-values/create-scroll
 */
// #234. An accessor `container` or `target` is read in an effect, and a change of either follows the
// new one. Each value carries one Atom for its life.
export const createScroll = (options: ScrollOptions = {}): ScrollValues => {
  if (isServer) return SERVER_SCROLL
  const runtime = useWardicRuntime()
  const services = useBrought(SCROLL)
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  // Its own four Atoms, set from the scroll of the elements there now.
  const outs = Rec.fromIterableWith(SCROLL_KEYS, (key) => [key, Atom.make(0)] as const)
  Arr.forEach(SCROLL_KEYS, (key) => onCleanup(registry.mount(outs[key])))
  // Its elements are read once the render has settled: a ref given as `() => box` is set during the
  // render, after this effect's first compute, and isn't a signal, so nothing would read it again.
  const [settled, setSettled] = createSignal(false)
  onSettledClientOnly(() => {
    setSettled(true)
  })
  createEffect(
    () =>
      Bool.match(settled(), {
        onTrue: () => ({ container: elementOf(options.container), target: elementOf(options.target) }),
        onFalse: () => NOT_YET,
      }),
    ({ container, target }) => {
      // A ref not there yet: the values hold until it is.
      if (Bool.or(Option.isNone(container), Option.isNone(target))) return undefined
      const scope = OwnerScope.open(runtime)
      const values = runtime.runSync(
        LiveValue.scroll({
          ...UndefinedOr.match(Option.getOrUndefined(container), { onUndefined: () => ({}), onDefined: (element) => ({ container: element }) }),
          ...UndefinedOr.match(Option.getOrUndefined(target), { onUndefined: () => ({}), onDefined: (element) => ({ target: element }) }),
          ...UndefinedOr.match(options.offset, { onUndefined: () => ({}), onDefined: (offset) => ({ offset }) }),
          ...UndefinedOr.match(options.axis, { onUndefined: () => ({}), onDefined: (axis) => ({ axis }) }),
        }).pipe(Effect.provideService(ScrollSource.ScrollSource, serviceOf(services(), ScrollSource.ScrollSource)), Scope.provide(scope)),
      )
      // Each derived Atom is read at once: it tracks the scroll only once it's been read.
      const stops = Arr.map(SCROLL_KEYS, (key) => registry.subscribe(values[key], (v) => registry.set(outs[key], v), { immediate: true }))
      return () => {
        Arr.forEach(stops, (stop) => stop())
        OwnerScope.close(runtime, scope, CLOSE_FAILED)
      }
    },
    CLIENT_ONLY,
  )
  return Rec.map(outs, (atom) => followAtom(registry, atom)) as unknown as ScrollValues
}
