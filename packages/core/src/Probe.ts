/**
 * The `Probe` module: Environment introspection, measurement, viewport, motion preferences and
 * observation streams, behind the `Probe.Probe` service (ADR-0028, decision 11).
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type { Atom } from "effect/reactivity"

/** Geometry of a measured target, in the environment's coordinate space. */
export interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** Viewport dimensions. */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/** One axis of a container's scroll (#234, ADR-0043 *Amendment (#233, #234)*). */
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

/** A container's scroll on both axes: what {@link Probe}'s `scroll` holds. */
export interface Scroll {
  readonly x: ScrollAxis
  readonly y: ScrollAxis
}

/** What {@link Probe}'s `scroll` reads, Motion's `scroll` options. */
export interface ScrollOptions {
  /** The scroll container: the Environment's page when left out. */
  readonly container?: unknown
  /** An element whose progress through the container `progress` reads, on `axis`. */
  readonly target?: unknown
  /**
   * Where on `axis` the target's progress runs, from 0 to 1, in the Environment's own terms, which
   * it reads and resolves (the DOM's: `@wardic/dom/ScrollOffset`). Core passes it through, as it
   * does `container` and `target`.
   */
  readonly offset?: unknown
  /** The axis `target` and `offset` apply to. Default `"y"`. */
  readonly axis?: "x" | "y"
}

/**
 * Environment introspection — measurement, viewport, motion preferences, scroll, and
 * observation streams. Powers layout animations, in-view detection, scroll-linked values and
 * reduced-motion handling.
 */
export class Probe extends Context.Service<Probe, {
  /** Measure a target's current bounds. */
  readonly measure: (target: unknown) => Effect.Effect<Bounds>
  /** Reactive viewport size. */
  readonly viewport: Atom.Atom<Viewport>
  /** Reactive `prefers-reduced-motion` preference. */
  readonly prefersReducedMotion: Atom.Atom<boolean>
  /**
   * A container's scroll, live (#234, ADR-0043 *Amendment (#233, #234)*): an Atom the Environment
   * sets as the container scrolls or resizes, within the event, so a value derived from it is
   * written in the frame that shows the scroll. Containers are shared: one listener a container,
   * however many read it, held while the Scope is.
   */
  readonly scroll: (options?: ScrollOptions) => Effect.Effect<Atom.Atom<Scroll>, never, Scope.Scope>
  /** Stream of bounds as a target resizes. */
  readonly observeResize: (target: unknown) => Stream.Stream<Bounds>
  /** Stream of visibility as a target enters/leaves the viewport. */
  readonly observeIntersection: (target: unknown) => Stream.Stream<boolean>
}>()("@wardic/Probe") {}
