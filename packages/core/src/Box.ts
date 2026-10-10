/**
 * The `Box` module: the box-based projection geometry's data model (ADR-0009), ported from
 * framer-motion's `motion-dom/src/projection/geometry/models.ts`.
 *
 * Projection works in a **min/max per-axis** representation rather than the
 * `{ x, y, width, height, top, ... }` shape of `Probe.Bounds`: every projection
 * formula (delta, apply, relative, tree-scale) is symmetric across the two axes,
 * so expressing a box as two `{ min, max }` axes collapses each operation to a
 * single per-axis function applied twice. Measured `Probe.Bounds` (from `Probe`)
 * convert to a {@link Box} once at the measure boundary ({@link fromBounds});
 * the binding converts back only when it needs `Probe.Bounds`-shaped output.
 *
 * P1a is PURE geometry — no DOM, no Effect, no Clock. Per ADR-0009 the functions
 * are immutable (return fresh objects); a mutate-into-output variant is a
 * measured optimisation for later, not now.
 */
import type * as Probe from "./Probe.ts"
import * as Scalar from "./Scalar.ts"

/**
 * One axis of a {@link Box}, as the interval it spans. For the x-axis
 * `min`/`max` are the left/right edges; for the y-axis, top/bottom. This is the
 * unit every projection formula operates on.
 */
export interface Axis {
  readonly min: number
  readonly max: number
}

/**
 * A box as two independent axes — the projection-internal geometry. `x` is the
 * horizontal interval (left→right), `y` the vertical (top→bottom). Equivalent to
 * a {@link Bounds} but in the form the projection math is written against.
 */
export interface Box {
  readonly x: Axis
  readonly y: Axis
}

/** The length an {@link Axis} spans (`max - min`). The size of that axis. */
export const length = (axis: Axis): number => axis.max - axis.min

/**
 * Convert a measured {@link Probe.Bounds} (Probe's `getBoundingClientRect` shape) into
 * the projection's {@link Box}: x spans left→right, y spans top→bottom. This is
 * the one conversion done at the measure boundary before any projection math.
 */
export const fromBounds = (b: Probe.Bounds): Box => ({
  x: { min: b.left, max: b.right },
  y: { min: b.top, max: b.bottom },
})

/**
 * Convert a projection {@link Box} back to a {@link Probe.Bounds} (reconstructing the
 * derived `x`/`y`/`width`/`height` fields), for the rare path that needs
 * `Probe.Bounds`-shaped output. `x`/`y` mirror `left`/`top` (the box's origin corner).
 */
export const toBounds = (box: Box): Probe.Bounds => {
  const left = box.x.min
  const top = box.y.min
  const right = box.x.max
  const bottom = box.y.max
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}
/** Interpolate one {@link Axis} toward another by `progress` (0 = `from`, 1 = `to`). */
export const mixAxis = (from: Axis, to: Axis, progress: number): Axis => ({
  min: Scalar.lerp(from.min, to.min, progress),
  max: Scalar.lerp(from.max, to.max, progress),
})

/**
 * Interpolate one {@link Box} toward another by `progress` — the box-animation
 * primitive the projection coordinator mixes each frame (the `from` is the
 * animation origin, `to` the layout target; ADR-0009 single-progress driver).
 */
export const mix = (from: Box, to: Box, progress: number): Box => ({
  x: mixAxis(from.x, to.x, progress),
  y: mixAxis(from.y, to.y, progress),
})
