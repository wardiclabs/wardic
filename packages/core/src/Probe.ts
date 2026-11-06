/**
 * The Probe: what an Environment can tell the engine about what it draws. It measures a target's box;
 * holds the viewport's size, whether the user prefers reduced motion, whether the Environment is shown,
 * and a container's scroll, live, as Atoms; and observes a target's resizes and whether it's in view.
 * Layout animations, in-view gestures, scroll-linked values and reduced motion all read it.
 *
 * @example
 * import * as Probe from "@wardic/core/Probe"
 *
 * const probe = yield* Probe.Probe
 * const bounds = yield* probe.measure(card)
 * const scroll = yield* probe.scroll({ container: list })
 */
// ADR-0028, decision 11. `prefersReducedMotion`, `pageVisible` and `margin`'s string syntax are the web's
// names: #610.
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type { Atom } from "effect/reactivity"
import type * as InputFeed from "./InputFeed.ts"

/** A target's box as an Environment measures it, in its coordinates: its corner, its size and its four edges. */
export interface Bounds {
  /** Its left edge: `left`. */
  readonly x: number
  /** Its top edge: `top`. */
  readonly y: number
  /** Its width. */
  readonly width: number
  /** Its height. */
  readonly height: number
  /** Its top edge. */
  readonly top: number
  /** Its right edge. */
  readonly right: number
  /** Its bottom edge. */
  readonly bottom: number
  /** Its left edge. */
  readonly left: number
}

/** The viewport's size: how much of its content the Environment shows. */
export interface Viewport {
  /** Its width. */
  readonly width: number
  /** Its height. */
  readonly height: number
}

/** One axis of a container's scroll. */
// #234, ADR-0043 *Amendment (#233, #234)*.
export interface ScrollAxis {
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

/** A container's scroll on both axes: what the Probe's `scroll` holds. */
export interface Scroll {
  /** Across. */
  readonly x: ScrollAxis
  /** Down. */
  readonly y: ScrollAxis
}

/** What the Probe's `scroll` reads, as Motion's `scroll` options. */
export interface ScrollOptions {
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

/** What an intersection is observed against, as Motion's `viewport`. Default: the viewport, no margin, any of the target. */
// #273, ADR-0047.
export interface IntersectionOptions {
  /** The container it's observed against: the viewport when left out. */
  readonly root?: unknown
  /** How far the container's edges are grown, or shrunk, before it counts, in the Environment's own syntax. */
  // #610: a string, the web's syntax in `@wardic/dom`.
  readonly margin?: string | undefined
  /** How much of the target must be in it to count: from 0, any of it, to 1, all of it. */
  readonly amount?: number | undefined
}

/** A target's intersection, as an Environment reports it. */
// #273.
export interface Intersection {
  /** Whether the target is in. */
  readonly intersecting: boolean
  /** The platform's own record of it, which core never reads: a binding hands it to an app's callback. */
  readonly raw?: unknown
}

/** An Environment's Probe. */
export class Probe extends Context.Service<Probe, {
  /** Measures `target`'s box, now. */
  readonly measure: (target: unknown) => Effect.Effect<Bounds>
  /** The viewport's size, live. */
  readonly viewport: Atom.Atom<Viewport>
  /** Whether the user prefers reduced motion, live, as their Environment reports it. */
  readonly prefersReducedMotion: Atom.Atom<boolean>
  /**
   * Whether the Environment is shown, live, as Motion's `usePageInView`: `false` while it's hidden, put
   * in the background, say.
   */
  // #443.
  readonly pageVisible: Atom.Atom<boolean>
  /**
   * A container's scroll, live: an Atom the Environment sets as the container scrolls or resizes, as it
   * happens, so a value derived from it is written in the frame that shows the scroll. One listener a
   * container, however many read it, held while the Scope is.
   */
  // #234, ADR-0043 *Amendment (#233, #234)*.
  readonly scroll: (options?: ScrollOptions) => Effect.Effect<Atom.Atom<Scroll>, never, Scope.Scope>
  /** A target's box each time it resizes. */
  readonly observeResize: (target: unknown) => Stream.Stream<Bounds>
  /**
   * A target's intersection with the viewport, or `options`' root: a report each time it comes in or
   * goes out, and the first as it starts. An Input feed, one observer per subscriber, since each may ask
   * its own root, margin and amount.
   */
  // #273; an **Input feed** (#318).
  readonly observeIntersection: (target: unknown, options?: IntersectionOptions) => InputFeed.InputFeed<Intersection>
}>()("@wardic/core/Probe") {}
