/**
 * An Environment's scroll: a container's scroll, live, as an Atom the Environment sets as the container
 * scrolls or resizes, as it happens, so a value derived from it is written in the frame that shows the
 * scroll. Scroll-linked values read it (`LiveValue.scroll`).
 *
 * @example
 * import * as ScrollSource from "@wardic/core/ScrollSource"
 *
 * const source = yield* ScrollSource.ScrollSource
 * const scroll = yield* source.scroll({ container: list })
 */
// #518, ADR-0067 *Amendment (#518)*, decision 5: the Probe's `scroll` until then (#234, ADR-0043
// *Amendment (#233, #234)*). A service of its own, so an app that reads no scroll ships none of an
// Environment's scroll code: the Solid binding's `scroll` Feature builds it, the Environment's when it
// gives one (`@wardic/test`'s), else the DOM's (`DomScrollSource`). Tier 2 (ADR-0008), for Environment
// authors.
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { Atom } from "effect/reactivity"

/** One axis of a container's scroll. */
// #234, ADR-0043 *Amendment (#233, #234)*.
export interface Axis {
  /** How far the container is scrolled on the axis, in the Environment's units. */
  readonly current: number
  /** How far it can scroll on the axis: 0 for a container that doesn't overflow. */
  readonly length: number
  /**
   * Progress, 0 to 1: through the container's scroll range, or, on the options' `axis` with a
   * `target` or an `offset`, through the offsets the target passes.
   */
  readonly progress: number
}

/** A container's scroll on both axes: what `scroll` holds. */
export interface Scroll {
  /** Across. */
  readonly x: Axis
  /** Down. */
  readonly y: Axis
}

/** What `scroll` reads, as Motion's `scroll` options. */
export interface Options {
  /** The scroll container: the Environment's own when left out. */
  readonly container?: unknown
  /** An element whose progress through the container `progress` reads, on `axis`. */
  readonly target?: unknown
  /**
   * Where on `axis` the target's progress runs, from 0 to 1, in the Environment's own terms, which it
   * reads and resolves, as `@wardic/dom`'s `ScrollOffset` does. Core passes it through, as it does
   * `container` and `target`.
   */
  readonly offset?: unknown
  /** The axis `target` and `offset` apply to. Default `"y"`. */
  readonly axis?: "x" | "y"
}

/** An Environment's scroll. */
export class ScrollSource extends Context.Service<ScrollSource, {
  /**
   * A container's scroll, live: an Atom the Environment sets as the container scrolls or resizes, as it
   * happens, so a value derived from it is written in the frame that shows the scroll. One listener a
   * container, however many read it, held while the Scope is.
   */
  readonly scroll: (options?: Options) => Effect.Effect<Atom.Atom<Scroll>, never, Scope.Scope>
}>()("@wardic/core/ScrollSource") {}
