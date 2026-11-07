/**
 * The Probe: what an Environment can tell the engine about what it draws. It measures a target's box;
 * holds the viewport's size, whether the user prefers reduced motion and whether the Environment is
 * shown, live, as Atoms; and observes a target's resizes and whether it's in view. Layout animations,
 * in-view gestures and reduced motion all read it. A container's scroll is `ScrollSource`'s.
 *
 * @example
 * import * as Probe from "@wardic/core/Probe"
 *
 * const probe = yield* Probe.Probe
 * const bounds = yield* probe.measure(card)
 */
// ADR-0028, decision 11. #610 (ADR-0036 *Amendment (#610)*): `visible`, not the web's `pageVisible`;
// `margin` is `unknown`, the Environment's syntax; `prefersReducedMotion` keeps its name, plain words in
// any Environment, where `reducedMotion` is the provider's setting. #518: `scroll` moved to `ScrollSource`,
// which the `scroll` Feature builds, so an app that reads no scroll ships none of its code.
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type * as Atom from "effect/reactivity/Atom"
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

/** What an intersection is observed against, as Motion's `viewport`. Default: the viewport, no margin, any of the target. */
// #273, ADR-0047.
export interface IntersectionOptions {
  /** The container it's observed against: the viewport when left out. */
  readonly root?: unknown
  /**
   * How far the container's edges are grown, or shrunk, before it counts, in the Environment's own
   * syntax: core passes it on, as it does `ScrollSource.Options.offset`.
   */
  // #610: `unknown`, as `ScrollSource.Options.offset` is; `@wardic/dom` takes the web's string (`rootMargin`).
  readonly margin?: unknown
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
  // #443; `pageVisible` until #610.
  readonly visible: Atom.Atom<boolean>
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
