import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type { Atom } from "effect/unstable/reactivity"

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

/**
 * Environment introspection — measurement, viewport, motion preferences, and
 * observation streams. Powers layout animations, in-view detection, and
 * reduced-motion handling.
 */
export class Probe extends Context.Service<Probe, {
  /** Measure a target's current bounds. */
  readonly measure: (target: unknown) => Effect.Effect<Bounds>
  /** Reactive viewport size. */
  readonly viewport: Atom.Atom<Viewport>
  /** Reactive `prefers-reduced-motion` preference. */
  readonly prefersReducedMotion: Atom.Atom<boolean>
  /** Stream of bounds as a target resizes. */
  readonly observeResize: (target: unknown) => Stream.Stream<Bounds>
  /** Stream of visibility as a target enters/leaves the viewport. */
  readonly observeIntersection: (target: unknown) => Stream.Stream<boolean>
}>()("@wardic/Probe") {}
