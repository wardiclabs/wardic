/**
 * Box-based projection geometry operations (ADR-0009), ported from
 * framer-motion's `motion-dom/src/projection/geometry/{delta-calc,delta-apply}.ts`.
 *
 * These are the load-bearing formulas of the projection tree: compute the
 * {@link Delta} that maps a source {@link Box} onto a target ({@link calcBoxDelta}),
 * apply a delta to project a box forward ({@link applyBoxDelta}), express a child
 * box relative to its parent ({@link calcRelativeBox}), and interpolate between
 * two boxes ({@link mixBox}). The binding's per-frame projection pass (P1b)
 * composes these; this module is PURE (no DOM/Effect/Clock).
 *
 * Three deliberate deviations from Motion's source, all documented inline:
 *   1. IMMUTABLE — every function returns a fresh object (ADR-0009 Option C);
 *      Motion mutates a caller-owned output to avoid per-frame allocation. A
 *      mutate-into-output variant is a measured optimisation for later.
 *   2. ZERO-LENGTH GUARD — a zero-size source axis yields `scale: 1` rather than
 *      `Infinity`/`NaN` (matches `flip()`'s guard).
 *   3. The snapping precisions + arithmetic are copied verbatim so results
 *      cross-check against Motion.
 */
import { lerp, type Point } from "../math/index.ts"
import { type Axis, type AxisDelta, type Box, calcLength, type Delta } from "./box.ts"

/** Below this distance from 1, a computed scale snaps to exactly 1 (Motion's `SCALE_PRECISION`). */
const SCALE_PRECISION = 0.0001
/** Below this distance from 0, a computed translate snaps to exactly 0 (Motion's `TRANSLATE_PRECISION`). */
const TRANSLATE_PRECISION = 0.01

/** `true` when `value` is within `maxDistance` of `target` (Motion's `isNear`). */
const isNear = (value: number, target: number, maxDistance: number): boolean =>
  Math.abs(value - target) <= maxDistance

/** Scale `point` by `scale` about the fixed `originPoint` (Motion's `scalePoint`). */
const scalePoint = (point: number, scale: number, originPoint: number): number =>
  (point - originPoint) * scale + originPoint

/**
 * The {@link AxisDelta} that maps `source` onto `target`, resolved around the
 * 0–1 `origin` fraction (default `0.5` = the axis centre, the transform-origin a
 * node scales/translates about; `layoutAnchor` overrides this in P4).
 *
 * `scale = len(target)/len(source)` (a zero-length source ⇒ scale 1, our guard);
 * `translate` shifts the origin point to its target position. Scale/translate
 * snap to 1/0 within Motion's precisions to avoid sub-pixel transform churn.
 */
export const calcAxisDelta = (source: Axis, target: Axis, origin = 0.5): AxisDelta => {
  const originPoint = lerp(source.min, source.max, origin)
  const sourceLength = calcLength(source)
  let scale = sourceLength === 0 ? 1 : calcLength(target) / sourceLength
  let translate = lerp(target.min, target.max, origin) - originPoint
  if (isNear(scale, 1, SCALE_PRECISION)) scale = 1
  if (isNear(translate, 0, TRANSLATE_PRECISION)) translate = 0
  return { translate, scale, origin, originPoint }
}

/**
 * The {@link Delta} mapping `source` onto `target`, per axis. `origin` is the
 * transform-origin as 0–1 fractions per axis (default centre `{x:0.5,y:0.5}`).
 */
export const calcBoxDelta = (source: Box, target: Box, origin: Point = { x: 0.5, y: 0.5 }): Delta => ({
  x: calcAxisDelta(source.x, target.x, origin.x),
  y: calcAxisDelta(source.y, target.y, origin.y),
})

/**
 * Project a single coordinate forward by a delta (Motion's `applyPointDelta`):
 * optional `boxScale` first (the ancestor/tree scale, used by P1b's tree pass),
 * then the delta's own `scale` about `originPoint`, then `translate`.
 */
export const applyPointDelta = (
  point: number,
  translate: number,
  scale: number,
  originPoint: number,
  boxScale?: number,
): number => {
  let p = point
  if (boxScale !== undefined) p = scalePoint(p, boxScale, originPoint)
  return scalePoint(p, scale, originPoint) + translate
}

/** Project an {@link Axis} forward by an {@link AxisDelta} — returns a fresh axis. */
export const applyAxisDelta = (axis: Axis, delta: AxisDelta): Axis => ({
  min: applyPointDelta(axis.min, delta.translate, delta.scale, delta.originPoint),
  max: applyPointDelta(axis.max, delta.translate, delta.scale, delta.originPoint),
})

/**
 * Project a {@link Box} forward by a {@link Delta} — returns a fresh box.
 * `applyBoxDelta(source, calcBoxDelta(source, target))` reproduces `target`.
 */
export const applyBoxDelta = (box: Box, delta: Delta): Box => ({
  x: applyAxisDelta(box.x, delta.x),
  y: applyAxisDelta(box.y, delta.y),
})

/**
 * Project a node's `layout` box through its ancestors' projection deltas to get
 * where it currently APPEARS on screen, plus the cumulative ancestor scale
 * (`treeScale`) — ported from Motion's `applyTreeDeltas`.
 *
 * `ancestorDeltas` is the node's ancestor projection deltas in ROOT-FIRST order
 * (outermost ancestor first, the node's parent last); each is applied in turn and
 * its scale multiplied into `treeScale`. `treeScale` snaps to 1 within the scale
 * precision. Returns a fresh corrected box + the `treeScale` point (the binding
 * feeds `treeScale` to `buildProjectionTransform`).
 *
 * Pure: the `display:contents` skip, scroll compensation (P3), and shared-element
 * transform (crossfade) that Motion folds in here are binding/DOM concerns — the
 * caller decides which ancestor deltas to pass.
 */
export const applyTreeDeltas = (
  layout: Box,
  ancestorDeltas: ReadonlyArray<Delta>,
): { readonly box: Box; readonly treeScale: Point } => {
  let box = layout
  let treeScaleX = 1
  let treeScaleY = 1
  for (const delta of ancestorDeltas) {
    treeScaleX *= delta.x.scale
    treeScaleY *= delta.y.scale
    box = applyBoxDelta(box, delta)
  }
  if (isNear(treeScaleX, 1, SCALE_PRECISION)) treeScaleX = 1
  if (isNear(treeScaleY, 1, SCALE_PRECISION)) treeScaleY = 1
  return { box, treeScale: { x: treeScaleX, y: treeScaleY } }
}

/**
 * Express `child` relative to `parent` at the 0–1 `anchor` fraction: subtract the
 * parent's anchor point (`mix(parent.min, parent.max, anchor)`) from the child's
 * coordinates. At `anchor: 0` (top/left) the result is the child measured from
 * the parent's top-left; at `0.5` it is measured from the parent's centre. This
 * is how a node's box is expressed in its parent's frame for the projection tree.
 */
export const calcRelativeAxis = (child: Axis, parent: Axis, anchor: number): Axis => {
  const anchorPoint = lerp(parent.min, parent.max, anchor)
  return { min: child.min - anchorPoint, max: child.max - anchorPoint }
}

/**
 * Express `child` relative to `parent`, per axis, at the 0–1 `anchor` (default
 * top-left `{x:0,y:0}` — the `layoutAnchor` default).
 */
export const calcRelativeBox = (child: Box, parent: Box, anchor: Point = { x: 0, y: 0 }): Box => ({
  x: calcRelativeAxis(child.x, parent.x, anchor.x),
  y: calcRelativeAxis(child.y, parent.y, anchor.y),
})

/** Interpolate one {@link Axis} toward another by `progress` (0 = `from`, 1 = `to`). */
export const mixAxis = (from: Axis, to: Axis, progress: number): Axis => ({
  min: lerp(from.min, to.min, progress),
  max: lerp(from.max, to.max, progress),
})

/**
 * Interpolate one {@link Box} toward another by `progress` — the box-animation
 * primitive the projection coordinator mixes each frame (the `from` is the
 * animation origin, `to` the layout target; ADR-0009 single-progress driver).
 */
export const mixBox = (from: Box, to: Box, progress: number): Box => ({
  x: mixAxis(from.x, to.x, progress),
  y: mixAxis(from.y, to.y, progress),
})
