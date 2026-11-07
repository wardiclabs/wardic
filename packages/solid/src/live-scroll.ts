/**
 * `createScroll` (#518): in a module of its own, apart from the other Live helpers, so what it brings
 * reaches only an app that reads a scroll, and the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import * as LiveValue from "@wardic/core/LiveValue"
import type * as ScrollOffset from "@wardic/dom/ScrollOffset"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import { CLOSE_FAILED, SERVER_ZERO } from "./live-value.ts"
import * as OwnerScope from "./owner-scope.ts"
import { useWardicRuntime } from "./provider.tsx"
import { isServer } from "./server.ts"

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

const SERVER_SCROLL: ScrollValues = { scrollX: SERVER_ZERO, scrollY: SERVER_ZERO, scrollXProgress: SERVER_ZERO, scrollYProgress: SERVER_ZERO }

/** An element source read now: `None` for an accessor whose ref hasn't arrived. */
const elementOf = (source: ElementSource): Option.Option<Element> =>
  Bool.match(Predicate.isFunction(source), {
    onTrue: () => Option.fromUndefinedOr((source as Accessor<Element | undefined>)()),
    onFalse: () => Option.some(source as Element),
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
// new one.
export const createScroll = (options: ScrollOptions = {}): ScrollValues => {
  const runtime = useWardicRuntime()
  if (isServer) return SERVER_SCROLL
  const [scrollX, setScrollX] = createSignal(0)
  const [scrollY, setScrollY] = createSignal(0)
  const [scrollXProgress, setScrollXProgress] = createSignal(0)
  const [scrollYProgress, setScrollYProgress] = createSignal(0)
  createEffect(() => {
    const container = UndefinedOr.match(options.container, { onUndefined: () => Option.some(undefined), onDefined: elementOf })
    const target = UndefinedOr.match(options.target, { onUndefined: () => Option.some(undefined), onDefined: elementOf })
    // A ref not there yet: the values hold until it is.
    if (Bool.or(Option.isNone(container), Option.isNone(target))) return
    const registry = runtime.runSync(AtomRegistry.AtomRegistry)
    const scope = OwnerScope.open(runtime)
    onCleanup(() => OwnerScope.close(runtime, scope, CLOSE_FAILED))
    const values = runtime.runSync(
      LiveValue.scroll({
        ...UndefinedOr.match(Option.getOrUndefined(container), { onUndefined: () => ({}), onDefined: (element) => ({ container: element }) }),
        ...UndefinedOr.match(Option.getOrUndefined(target), { onUndefined: () => ({}), onDefined: (element) => ({ target: element }) }),
        ...UndefinedOr.match(options.offset, { onUndefined: () => ({}), onDefined: (offset) => ({ offset }) }),
        ...UndefinedOr.match(options.axis, { onUndefined: () => ({}), onDefined: (axis) => ({ axis }) }),
      }).pipe(Scope.provide(scope)),
    )
    // Each derived Atom is read at once: it tracks the scroll only once it's been read.
    const stops = Arr.map(
      [
        [values.scrollX, setScrollX],
        [values.scrollY, setScrollY],
        [values.scrollXProgress, setScrollXProgress],
        [values.scrollYProgress, setScrollYProgress],
      ] as const,
      ([atom, set]) => registry.subscribe(atom, (v) => void set(v), { immediate: true }),
    )
    onCleanup(() => Arr.forEach(stops, (stop) => stop()))
  })
  return { scrollX, scrollY, scrollXProgress, scrollYProgress }
}
