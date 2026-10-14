/**
 * The `Projection` module: the projection tree's geometry (ADR-0009), its {@link Delta} and the
 * value the coordinator writes under {@link KEY}. The operations are ported from
 * framer-motion's `motion-dom/src/projection/geometry/{delta-calc,delta-apply}.ts`.
 *
 * These are the load-bearing formulas of the projection tree: compute the
 * {@link Delta} that maps a source {@link Box.Box} onto a target ({@link calcBoxDelta}),
 * apply a delta to project a box forward ({@link applyBoxDelta}), express a child
 * box relative to its parent ({@link calcRelativeBox}), and interpolate between
 * two boxes (`Box.mix`). The binding's per-frame projection pass (P1b)
 * composes these; this module is PURE (no DOM/Effect/Clock).
 *
 * Three deliberate deviations from Motion's source, all documented inline:
 *   1. IMMUTABLE — every function returns a fresh object (ADR-0009 Option C);
 *      Motion mutates a caller-owned output to avoid per-frame allocation. A
 *      mutate-into-output variant is a measured optimisation for later.
 *   2. ZERO-LENGTH GUARD — a zero-size source axis yields `scale: 1` rather than
 *      `Infinity`/`NaN` (matches `Flip.make`'s guard).
 *   3. The snapping precisions + arithmetic are copied verbatim so results
 *      cross-check against Motion.
 */
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Box from "./Box.ts"
import type * as Point from "./Point.ts"
import * as Scalar from "./Scalar.ts"

/**
 * The transform that maps one {@link Box.Axis} onto another (the per-axis half of a
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

/** A box transform — an {@link AxisDelta} per axis. Maps a source {@link Box.Box} onto a target. */
export interface Delta {
  readonly x: AxisDelta
  readonly y: AxisDelta
}

/**
 * The reserved gate value-map key under which the projection coordinator writes
 * a node's per-frame {@link Value} (ADR-0009). The DOM renderer's
 * `project()` reads this key to assemble the projection transform (weaving the
 * element's own animated `rotate`/`skew` from the same value-map) instead of the
 * normal transform grouping. Namespaced (`@…`) so it never collides with a CSS
 * property or animated value key. This is the contract between the binding
 * coordinator (writer) and the renderer (reader); it lives in core because that
 * is their only shared dependency.
 */
export const KEY = "@projection"

/**
 * The payload the projection coordinator writes under {@link KEY}: the
 * node's projection {@link Delta} (layout box → animating target box) plus the
 * cumulative ancestor `treeScale`. The renderer turns these into the transform
 * `translate3d(...) scale(1/treeScale) [user rotate/skew] scale(delta*treeScale)`.
 */
export interface Value {
  readonly delta: Delta
  readonly treeScale: Point.Point
  /**
   * Optional shared-element crossfade factor (ADR-0010), 0–1. When present the
   * renderer composes `finalOpacity = (userOpacity ?? 1) × opacity` in the
   * `@projection` branch — the lead fades in (`mix(0,1,progress)`), followers fade
   * out (`mix(1,0,progress)`). Absent for a plain layout node (no crossfade), so
   * the user's opacity passes through untouched.
   */
  readonly opacity?: number
  /**
   * A Switch's blended opacity (ADR-0010, *Amendment (#166)*), 0–1: drawn as the element's opacity
   * as it is, in place of its own and of any crossfade factor, from the leaver's opacity to the
   * element's own over the handover. Absent otherwise.
   */
  readonly blendOpacity?: number
  /**
   * A handover's blended rotation in degrees (ADR-0010, *Amendment (#166)*): woven in place of the
   * element's own `rotate`, from the twin's to its own over the handover; a Follower is drawn with
   * its Lead's. Absent otherwise, so the element's own `rotate` shows.
   */
  readonly rotate?: number
  /**
   * Optional stacking raise (ADR-0016, *Amendment (Reorder)*): while present the
   * renderer emits it as `z-index`, so a dragged node paints above its siblings (Motion's
   * Reorder item, `zIndex: 1` while it's off its slot). Absent at rest, so the element's
   * own z-index shows.
   */
  readonly raise?: number
  /**
   * Present on a Follower (ADR-0010, *Amendment (#165)*): pointer input passes through it to
   * what's beneath, so a Follower locked onto its Lead's box never takes the Lead's input,
   * fading out or hidden at rest (Motion's). The DOM's renderer writes `pointer-events: none`.
   * Absent on a Lead, so the element's own value shows.
   */
  readonly passesPointer?: true
}

/** Below this distance from 1, a computed scale snaps to exactly 1 (Motion's `SCALE_PRECISION`). */
const SCALE_PRECISION = 0.0001
/** Below this distance from 0, a computed translate snaps to exactly 0 (Motion's `TRANSLATE_PRECISION`). */
const TRANSLATE_PRECISION = 0.01
/**
 * Strictly inside this range a `treeScale` snaps to exactly 1 (Motion's `TREE_SCALE_SNAP_MIN` and
 * `TREE_SCALE_SNAP_MAX`, delta-apply.ts; ADR-0009 *Amendment (#9)*): only float noise. Ancestors'
 * scales that nearly cancel (1.5 × 0.6667) keep their product, as Motion's do.
 */
const TREE_SCALE_SNAP_MIN = 0.999999999999
const TREE_SCALE_SNAP_MAX = 1.0000000000001

/** `true` when `value` is within `maxDistance` of `target` (Motion's `isNear`). */
const isNear = (value: number, target: number, maxDistance: number): boolean =>
  Math.abs(value - target) <= maxDistance

/** Scale `point` by `scale` about the fixed `originPoint` (Motion's `scalePoint`). */
const scalePoint = (point: number, scale: number, originPoint: number): number =>
  (point - originPoint) * scale + originPoint

/**
 * The scale from `source` to `target`: their length ratio, or 1 for a zero-length `source`.
 * On the per-frame path (ADR-0025), dom's projection pass calls it per node: an early return.
 */
const scaleOf = (source: Box.Axis, target: Box.Axis): number => {
  const sourceLength = Box.length(source)
  if (sourceLength === 0) return 1
  return Box.length(target) / sourceLength
}

/**
 * The {@link AxisDelta} that maps `source` onto `target`, resolved around the
 * 0–1 `origin` fraction (default `0.5` = the axis centre, the transform-origin a
 * node scales/translates about; `layoutAnchor` overrides this in P4).
 *
 * `scale = len(target)/len(source)` (a zero-length source ⇒ scale 1, our guard);
 * `translate` shifts the origin point to its target position. Scale/translate
 * snap to 1/0 within Motion's precisions to avoid sub-pixel transform churn.
 */
export const calcAxisDelta = (source: Box.Axis, target: Box.Axis, origin = 0.5): AxisDelta => {
  const originPoint = Scalar.lerp(source.min, source.max, origin)
  let scale = scaleOf(source, target)
  let translate = Scalar.lerp(target.min, target.max, origin) - originPoint
  if (isNear(scale, 1, SCALE_PRECISION)) scale = 1
  if (isNear(translate, 0, TRANSLATE_PRECISION)) translate = 0
  return { translate, scale, origin, originPoint }
}

/**
 * The {@link Delta} mapping `source` onto `target`, per axis. `origin` is the
 * transform-origin as 0–1 fractions per axis (default centre `{x:0.5,y:0.5}`).
 */
export const calcBoxDelta = (source: Box.Box, target: Box.Box, origin: Point.Point = { x: 0.5, y: 0.5 }): Delta => ({
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
  if (Predicate.isNotUndefined(boxScale)) p = scalePoint(p, boxScale, originPoint)
  return scalePoint(p, scale, originPoint) + translate
}

/** Project an {@link Box.Axis} forward by an {@link AxisDelta} — returns a fresh axis. */
export const applyAxisDelta = (axis: Box.Axis, delta: AxisDelta): Box.Axis => ({
  min: applyPointDelta(axis.min, delta.translate, delta.scale, delta.originPoint),
  max: applyPointDelta(axis.max, delta.translate, delta.scale, delta.originPoint),
})

/**
 * Project a {@link Box.Box} forward by a {@link Delta} — returns a fresh box.
 * `applyBoxDelta(source, calcBoxDelta(source, target))` reproduces `target`.
 */
export const applyBoxDelta = (box: Box.Box, delta: Delta): Box.Box => ({
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
 * its scale multiplied into `treeScale`. `treeScale` snaps to 1 strictly inside Motion's
 * `TREE_SCALE_SNAP_MIN`–`TREE_SCALE_SNAP_MAX`. Returns a fresh corrected box + the `treeScale` point (the binding
 * feeds `treeScale` to `buildProjectionTransform`).
 *
 * Pure: the `display:contents` skip, scroll compensation (P3), and shared-element
 * transform (crossfade) that Motion folds in here are binding/DOM concerns — the
 * caller decides which ancestor deltas to pass.
 */
export const applyTreeDeltas = (
  layout: Box.Box,
  ancestorDeltas: ReadonlyArray<Delta>,
): { readonly box: Box.Box; readonly treeScale: Point.Point } => {
  let box = layout
  let treeScaleX = 1
  let treeScaleY = 1
  for (const delta of ancestorDeltas) {
    treeScaleX *= delta.x.scale
    treeScaleY *= delta.y.scale
    box = applyBoxDelta(box, delta)
  }
  if (treeScaleX > TREE_SCALE_SNAP_MIN && treeScaleX < TREE_SCALE_SNAP_MAX) treeScaleX = 1
  if (treeScaleY > TREE_SCALE_SNAP_MIN && treeScaleY < TREE_SCALE_SNAP_MAX) treeScaleY = 1
  return { box, treeScale: { x: treeScaleX, y: treeScaleY } }
}

/**
 * Express `child` relative to `parent` at the 0–1 `anchor` fraction: subtract the
 * parent's anchor point (`mix(parent.min, parent.max, anchor)`) from the child's
 * coordinates. At `anchor: 0` (top/left) the result is the child measured from
 * the parent's top-left; at `0.5` it is measured from the parent's centre. This
 * is how a node's box is expressed in its parent's frame for the projection tree.
 */
export const calcRelativeAxis = (child: Box.Axis, parent: Box.Axis, anchor: number): Box.Axis => {
  const anchorPoint = Scalar.lerp(parent.min, parent.max, anchor)
  return { min: child.min - anchorPoint, max: child.max - anchorPoint }
}

/**
 * Express `child` relative to `parent`, per axis, at the 0–1 `anchor` (default
 * top-left `{x:0,y:0}` — the `layoutAnchor` default).
 */
export const calcRelativeBox = (child: Box.Box, parent: Box.Box, anchor: Point.Point = { x: 0, y: 0 }): Box.Box => ({
  x: calcRelativeAxis(child.x, parent.x, anchor.x),
  y: calcRelativeAxis(child.y, parent.y, anchor.y),
})

/**
 * Inverse of {@link calcRelativeAxis}: place a relative axis back into `parent`
 * at the 0–1 `anchor` — ADD the parent's anchor point. `placeRelativeAxis(calcRelativeAxis(c, p, a), p, a) === c`.
 */
export const placeRelativeAxis = (relative: Box.Axis, parent: Box.Axis, anchor: number): Box.Axis => {
  const anchorPoint = Scalar.lerp(parent.min, parent.max, anchor)
  return { min: relative.min + anchorPoint, max: relative.max + anchorPoint }
}

/**
 * Place a relative {@link Box.Box} into `parent`, per axis (the inverse of
 * {@link calcRelativeBox}). Used by relative projection: a child's offset within
 * its parent, placed into the parent's CURRENT (animating) target, yields the
 * child's viewport target — so the child tracks the parent regardless of their
 * relative progress (ADR-0009, "not left behind").
 */
export const placeRelativeBox = (relative: Box.Box, parent: Box.Box, anchor: Point.Point = { x: 0, y: 0 }): Box.Box => ({
  x: placeRelativeAxis(relative.x, parent.x, anchor.x),
  y: placeRelativeAxis(relative.y, parent.y, anchor.y),
})

/**
 * A projection node's **Layout mode** (CONTEXT.md; ADR-0009, *Amendment (#42)*): which parts of
 * a layout change its layout animation animates. `true` animates both position and size;
 * `"position"` its position only, its size taking the new value at once; `"size"` its size only;
 * `"x"` / `"y"` that axis only; `"preserve-aspect"` both while the width/height ratio stays
 * within 0.2, else its position only. Motion's `animationType`.
 */
export type LayoutMode = true | "position" | "size" | "preserve-aspect" | "x" | "y"

/** How far two width/height ratios may be apart for `"preserve-aspect"` to animate both (Motion's `isNear(…, 0.2)`). */
const ASPECT_NEAR = 0.2

/** A box's width/height ratio. */
const aspectOf = (box: Box.Box): number => Box.length(box.x) / Box.length(box.y)

/**
 * Whether `mode` animates only the position of a layout change from `from` to `to`: `"position"`,
 * or `"preserve-aspect"` when the two width/height ratios are more than 0.2 apart (Motion's
 * `shouldAnimatePositionOnly`, create-projection-node.ts:2449-2459 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8). Plain operators: a Follower reads it every frame.
 */
export const animatesPositionOnly = (mode: LayoutMode, from: Box.Box, to: Box.Box): boolean =>
  mode === "position" || (mode === "preserve-aspect" && Math.abs(aspectOf(from) - aspectOf(to)) > ASPECT_NEAR)

/** `box` with `like`'s size, at its own top-left (`min`). A Follower's per-frame target: no allocation beyond the box. */
export const withSizeOf = (box: Box.Box, like: Box.Box): Box.Box => ({
  x: { min: box.x.min, max: box.x.min + Box.length(like.x) },
  y: { min: box.y.min, max: box.y.min + Box.length(like.y) },
})

/** `box` moved to `to`'s top-left, its own size kept. */
const movedTo = (box: Box.Box, to: Box.Box): Box.Box => ({
  x: { min: to.x.min, max: to.x.min + Box.length(box.x) },
  y: { min: to.y.min, max: to.y.min + Box.length(box.y) },
})

/**
 * Where a layout animation from `origin` to `target` starts under `mode` (Motion's
 * `notifyLayoutUpdate`, create-projection-node.ts:2163-2205 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8): `"size"` moves `origin` to `target`'s top-left, so
 * only its size animates; `"x"` / `"y"` take the other axis from `target`; a position-only mode
 * ({@link animatesPositionOnly}) gives `origin` `target`'s size at its own top-left, so only its
 * position animates; `true` leaves it as it is. Once per layout animation's start.
 */
export const shapeOrigin = (mode: LayoutMode, origin: Box.Box, target: Box.Box): Box.Box =>
  Match.value(mode).pipe(
    Match.when("size", () => movedTo(origin, target)),
    Match.when("x", (): Box.Box => ({ x: origin.x, y: target.y })),
    Match.when("y", (): Box.Box => ({ x: target.x, y: origin.y })),
    Match.orElse(() =>
      Bool.match(animatesPositionOnly(mode, origin, target), { onTrue: () => withSizeOf(origin, target), onFalse: () => origin })),
  )

