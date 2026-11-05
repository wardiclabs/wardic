/**
 * Boxes as layout projection works with them: two axes, each the interval it spans, `{ min, max }`, so
 * every projection formula is one function per axis, applied twice. A measured `Probe.Bounds` becomes a
 * `Box` once, with `fromBounds`, and turns back with `toBounds` where something needs bounds again; `mix`
 * blends one box toward another, as a layout animation does each frame.
 *
 * @example
 * import * as Box from "@wardic/core/Box"
 *
 * const box = Box.fromBounds(bounds)
 * Box.length(box.x) // its width
 * const halfway = Box.mix(from, to, 0.5)
 */
// ADR-0009: ported from Motion's `motion-dom/src/projection/geometry/models.ts`. Pure geometry: no Effect,
// no Clock. Immutable, each function returning a fresh object; a mutate-into-output variant is a measured
// optimisation for later.
import type * as Probe from "./Probe.ts"
import * as Scalar from "./Scalar.ts"

/** One axis of a box, as the interval it spans: its left and right edges across, its top and bottom down. */
export interface Axis {
  /** Where it starts: the left edge, or the top. */
  readonly min: number
  /** Where it ends: the right edge, or the bottom. */
  readonly max: number
}

/** A box as two axes: the interval it spans across, and the one down. */
export interface Box {
  /** Across: left to right. */
  readonly x: Axis
  /** Down: top to bottom. */
  readonly y: Axis
}

/** How long an axis is: `max - min`, the box's width or height. */
export const length = (axis: Axis): number => axis.max - axis.min

/** A measured `Probe.Bounds` as a `Box`: across from its left edge to its right, down from its top to its bottom. */
// The one conversion at the measure boundary, before any projection math.
export const fromBounds = (b: Probe.Bounds): Box => ({
  x: { min: b.left, max: b.right },
  y: { min: b.top, max: b.bottom },
})

/** A `Box` as `Probe.Bounds`, its `x` and `y` at its top-left corner: for what needs bounds again. */
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
/** An axis `progress` of the way from `from` to `to`: `from` at 0, `to` at 1. */
export const mixAxis = (from: Axis, to: Axis, progress: number): Axis => ({
  min: Scalar.lerp(from.min, to.min, progress),
  max: Scalar.lerp(from.max, to.max, progress),
})

/** A box `progress` of the way from `from` to `to`, as a layout animation draws it each frame. */
// The box-animation primitive the projection coordinator mixes each frame (ADR-0009, a single-progress
// driver): `from` is the animation's origin, `to` the layout target.
export const mix = (from: Box, to: Box, progress: number): Box => ({
  x: mixAxis(from.x, to.x, progress),
  y: mixAxis(from.y, to.y, progress),
})
