/**
 * The box-based projection geometry's data model (ADR-0009), ported from
 * framer-motion's `motion-dom/src/projection/geometry/models.ts`.
 *
 * Projection works in a **min/max per-axis** representation rather than the
 * `{ x, y, width, height, top, ... }` shape of {@link Bounds}: every projection
 * formula (delta, apply, relative, tree-scale) is symmetric across the two axes,
 * so expressing a box as two `{ min, max }` axes collapses each operation to a
 * single per-axis function applied twice. Measured `Bounds` (from `Probe`)
 * convert to a {@link Box} once at the measure boundary ({@link boundsToBox});
 * the binding converts back only when it needs `Bounds`-shaped output.
 *
 * P1a is PURE geometry — no DOM, no Effect, no Clock. Per ADR-0009 the functions
 * are immutable (return fresh objects); a mutate-into-output variant is a
 * measured optimisation for later, not now.
 */
import type { Point } from "../math/index.ts"
import type { Bounds } from "../services/Probe.ts"

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

/**
 * The transform that maps one {@link Axis} onto another (the per-axis half of a
 * {@link Delta}), as framer-motion computes it:
 * - `origin`: the 0–1 anchor fraction the scale/translate are resolved around.
 * - `originPoint`: that anchor as an absolute coordinate in the *source* axis
 *   (`mix(source.min, source.max, origin)`).
 * - `scale`: `len(target) / len(source)`.
 * - `translate`: the shift that places the anchor at its target position.
 */
export interface AxisDelta {
  readonly translate: number
  readonly scale: number
  readonly origin: number
  readonly originPoint: number
}

/** A box transform — an {@link AxisDelta} per axis. Maps a source {@link Box} onto a target. */
export interface Delta {
  readonly x: AxisDelta
  readonly y: AxisDelta
}

/** The length an {@link Axis} spans (`max - min`). The size of that axis. */
export const calcLength = (axis: Axis): number => axis.max - axis.min

/**
 * The reserved gate value-map key under which the projection coordinator writes
 * a node's per-frame {@link ProjectionValue} (ADR-0009). The DOM renderer's
 * `project()` reads this key to assemble the projection transform (weaving the
 * element's own animated `rotate`/`skew` from the same value-map) instead of the
 * normal transform grouping. Namespaced (`@…`) so it never collides with a CSS
 * property or animated value key. This is the contract between the binding
 * coordinator (writer) and the renderer (reader); it lives in core because that
 * is their only shared dependency.
 */
export const PROJECTION_KEY = "@projection"

/**
 * The payload the projection coordinator writes under {@link PROJECTION_KEY}: the
 * node's projection {@link Delta} (layout box → animating target box) plus the
 * cumulative ancestor `treeScale`. The renderer turns these into the transform
 * `translate3d(...) scale(1/treeScale) [user rotate/skew] scale(delta*treeScale)`.
 */
export interface ProjectionValue {
  readonly delta: Delta
  readonly treeScale: Point
  /**
   * Optional shared-element crossfade factor (ADR-0010), 0–1. When present the
   * renderer composes `finalOpacity = (userOpacity ?? 1) × opacity` in the
   * `@projection` branch — the lead fades in (`mix(0,1,progress)`), followers fade
   * out (`mix(1,0,progress)`). Absent for a plain layout node (no crossfade), so
   * the user's opacity passes through untouched.
   */
  readonly opacity?: number
  /**
   * Optional stacking raise (ADR-0016, *Amendment (Reorder)*): while present the
   * renderer emits it as `z-index`, so a dragged node paints above its siblings (Motion's
   * Reorder item, `zIndex: 1` while it's off its slot). Absent at rest, so the element's
   * own z-index shows.
   */
  readonly raise?: number
}

/**
 * Convert a measured {@link Bounds} (Probe's `getBoundingClientRect` shape) into
 * the projection's {@link Box}: x spans left→right, y spans top→bottom. This is
 * the one conversion done at the measure boundary before any projection math.
 */
export const boundsToBox = (b: Bounds): Box => ({
  x: { min: b.left, max: b.right },
  y: { min: b.top, max: b.bottom },
})

/**
 * Convert a projection {@link Box} back to a {@link Bounds} (reconstructing the
 * derived `x`/`y`/`width`/`height` fields), for the rare path that needs
 * `Bounds`-shaped output. `x`/`y` mirror `left`/`top` (the box's origin corner).
 */
export const boxToBounds = (box: Box): Bounds => {
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
