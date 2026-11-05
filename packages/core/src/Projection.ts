/**
 * Layout projection's geometry, as Motion's: the `Delta` that maps one box onto another
 * (`calcBoxDelta`), a delta applied to a box (`applyBoxDelta`), a box drawn through its ancestors' deltas
 * (`applyTreeDeltas`), and a box relative to its parent's (`calcRelativeBox`, `placeRelativeBox`). A
 * binding's projection pass composes them each frame, and writes each node's `Value` under `KEY` for its
 * Environment's renderer to draw. `LayoutMode` says which parts of a layout change animate.
 *
 * @example
 * import * as Projection from "@wardic/core/Projection"
 *
 * const delta = Projection.calcBoxDelta(layout, target)
 * Projection.applyBoxDelta(layout, delta) // `target`
 */
// ADR-0009: ported from Motion's `motion-dom/src/projection/geometry/{delta-calc,delta-apply}.ts`. Pure:
// no Effect, no Clock. Three deliberate deviations from Motion's source, all documented inline:
//   1. Immutable: every function returns a fresh object (ADR-0009 Option C); Motion mutates a
//      caller-owned output to avoid per-frame allocation. A mutate-into-output variant is a measured
//      optimisation for later.
//   2. A zero-length guard: a zero-size source axis yields `scale: 1` rather than `Infinity`/`NaN`
//      (matches `Flip.make`'s guard).
//   3. The snapping precisions and arithmetic are copied verbatim, so results cross-check against
//      Motion.
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Box from "./Box.ts"
import type * as Point from "./Point.ts"
import * as Scalar from "./Scalar.ts"

/** What maps one axis onto another: half a `Delta`. */
export interface AxisDelta {
  /** The move that puts the origin point where it is on the target. */
  readonly translate: number
  /** The target's length over the source's. */
  readonly scale: number
  /** Where along the source it scales about, from 0 to 1: 0.5, its middle, by default. */
  readonly origin: number
  /** That point, on the source: its `min`, plus `origin` of its length. */
  readonly originPoint: number
}

/** What maps one box onto another: an `AxisDelta` on each axis. */
export interface Delta {
  /** Across. */
  readonly x: AxisDelta
  /** Down. */
  readonly y: AxisDelta
}

/**
 * The key a projection pass writes each node's `Value` under, each frame, for its Environment's renderer
 * to draw as one transform with the element's own rotation and skew. Namespaced, `@projection`, so it
 * never collides with an animated key.
 */
// ADR-0009. `@wardic/dom`'s renderer's `project()` reads it in place of its normal transform grouping.
// The contract between the binding's coordinator (the writer) and the renderer (the reader); it lives in
// core because that is their only shared dependency.
export const KEY = "@projection"

/**
 * What a projection pass writes under `KEY` for a node, each frame: its `Delta`, from its layout box to
 * where it's drawn, and its ancestors' scale, which the renderer takes back out so the node isn't scaled
 * twice.
 */
// `@wardic/dom`'s renderer draws `translate3d(...) scale(1/treeScale) [user rotate/skew]
// scale(delta*treeScale)`.
export interface Value {
  /** From the node's layout box to where it's drawn. */
  readonly delta: Delta
  /** Its ancestors' scale, multiplied together. */
  readonly treeScale: Point.Point
  /**
   * A shared element's crossfade, from 0 to 1: the element's own opacity is multiplied by it. The lead
   * fades in, the followers fade out. Absent for a plain layout node, so its own opacity shows.
   */
  // ADR-0010.
  readonly opacity?: number
  /**
   * A handover's blended opacity, from 0 to 1: drawn as the element's opacity in place of its own and of
   * any crossfade, from the leaving element's opacity to its own over the handover. Absent otherwise.
   */
  // A Switch's (ADR-0010, *Amendment (#166)*).
  readonly blendOpacity?: number
  /**
   * A handover's blended rotation, in degrees: drawn in place of the element's own `rotate`, from its
   * twin's to its own over the handover. A follower is drawn with its lead's. Absent otherwise, so the
   * element's own `rotate` shows.
   */
  // ADR-0010, *Amendment (#166)*.
  readonly rotate?: number
  /**
   * A raise above its siblings: while it's set, the renderer draws the node above them, as a dragged
   * Reorder item is while it's off its place. Absent at rest, so the element's own stacking shows.
   */
  // ADR-0016, *Amendment (Reorder)*: Motion's Reorder item, `zIndex: 1`; `@wardic/dom` writes it as
  // `z-index`.
  readonly raise?: number
  /**
   * Set on a follower: pointer input passes through it to what's beneath, so a follower drawn on its
   * lead's box never takes the lead's input, fading out or hidden at rest, as Motion's. How a renderer
   * lets it through is its Environment's. Absent on a lead, so the element's own value shows.
   */
  // ADR-0010, *Amendment (#165)*; `@wardic/dom`'s renderer.
  readonly passesPointer?: true
}

/** An axis with nothing to project: no shift, no scale. */
const REST_AXIS: AxisDelta = { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }

/**
 * A node drawn at its own box: no delta, no ancestors' scale. The renderer draws it with the element's
 * own rotation, skew and scale, and leaves its own move out, as it draws a layout node at rest. What a
 * server, which measures nothing, draws a layout node's starting style and mount animation with.
 */
// #245; the projection owns its translate (ADR-0016); ADR-0021 (the server measures nothing): the
// Starting style and the Appear animation.
export const AT_REST: Value = { delta: { x: REST_AXIS, y: REST_AXIS }, treeScale: { x: 1, y: 1 } }

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
 * On the per-frame path (ADR-0025), `@wardic/dom`'s projection pass calls it per node: an early return.
 */
const scaleOf = (source: Box.Axis, target: Box.Axis): number => {
  const sourceLength = Box.length(source)
  if (sourceLength === 0) return 1
  return Box.length(target) / sourceLength
}

/**
 * The `AxisDelta` that maps `source` onto `target`, about `origin`, from 0 to 1 along it: 0.5, its middle,
 * by default. The scale is the lengths' ratio, 1 for a `source` of no length; the move puts the origin
 * point where it is on `target`. Both snap to 1 and 0 within Motion's precisions, so no transform
 * changes by a fraction of a pixel.
 */
// `layoutAnchor` overrides the origin (P4).
export const calcAxisDelta = (source: Box.Axis, target: Box.Axis, origin = 0.5): AxisDelta => {
  const originPoint = Scalar.lerp(source.min, source.max, origin)
  let scale = scaleOf(source, target)
  let translate = Scalar.lerp(target.min, target.max, origin) - originPoint
  if (isNear(scale, 1, SCALE_PRECISION)) scale = 1
  if (isNear(translate, 0, TRANSLATE_PRECISION)) translate = 0
  return { translate, scale, origin, originPoint }
}

/** The `Delta` that maps `source` onto `target`, about `origin`, from 0 to 1 on each axis: the middle by default. */
export const calcBoxDelta = (source: Box.Box, target: Box.Box, origin: Point.Point = { x: 0.5, y: 0.5 }): Delta => ({
  x: calcAxisDelta(source.x, target.x, origin.x),
  y: calcAxisDelta(source.y, target.y, origin.y),
})

/**
 * A coordinate projected by a delta, as Motion's `applyPointDelta`: scaled by `boxScale` first, when it's
 * given, the ancestors' scale, then by the delta's own `scale` about `originPoint`, then moved by
 * `translate`.
 */
// `boxScale` is the tree pass's (P1b).
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

/** An axis projected by an `AxisDelta`: a fresh axis. */
export const applyAxisDelta = (axis: Box.Axis, delta: AxisDelta): Box.Axis => ({
  min: applyPointDelta(axis.min, delta.translate, delta.scale, delta.originPoint),
  max: applyPointDelta(axis.max, delta.translate, delta.scale, delta.originPoint),
})

/** A box projected by a `Delta`: a fresh box. `applyBoxDelta(source, calcBoxDelta(source, target))` is `target`. */
export const applyBoxDelta = (box: Box.Box, delta: Delta): Box.Box => ({
  x: applyAxisDelta(box.x, delta.x),
  y: applyAxisDelta(box.y, delta.y),
})

/**
 * Where a node's `layout` box is drawn, through its ancestors' deltas, and its ancestors' scale, as
 * Motion's `applyTreeDeltas`. `ancestorDeltas` are its ancestors' deltas, the outermost first and its
 * parent last: each is applied in turn, and its scale multiplied into `treeScale`, which snaps to 1 when
 * it's within float noise of it. The caller decides which ancestors' deltas to pass: what Motion also
 * folds in here, a node with no box of its own, a scroll's compensation, a shared element's transform,
 * is the caller's.
 */
// Motion's `TREE_SCALE_SNAP_MIN`–`TREE_SCALE_SNAP_MAX`. The binding feeds `treeScale` to
// `buildProjectionTransform`. What's skipped: `display:contents`, scroll compensation (P3), the
// crossfade's transform.
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
 * `child` relative to `parent`, measured from the point `anchor`, from 0 to 1, along `parent`: at 0, from
 * its start; at 0.5, from its middle. How a node's box is put in its parent's terms.
 */
export const calcRelativeAxis = (child: Box.Axis, parent: Box.Axis, anchor: number): Box.Axis => {
  const anchorPoint = Scalar.lerp(parent.min, parent.max, anchor)
  return { min: child.min - anchorPoint, max: child.max - anchorPoint }
}

/** `child` relative to `parent` on each axis, at `anchor`: their top-left by default, as Motion's `layoutAnchor`. */
export const calcRelativeBox = (child: Box.Box, parent: Box.Box, anchor: Point.Point = { x: 0, y: 0 }): Box.Box => ({
  x: calcRelativeAxis(child.x, parent.x, anchor.x),
  y: calcRelativeAxis(child.y, parent.y, anchor.y),
})

/**
 * `calcRelativeAxis` undone: a relative axis placed back into `parent` at `anchor`.
 * `placeRelativeAxis(calcRelativeAxis(c, p, a), p, a)` is `c`.
 */
export const placeRelativeAxis = (relative: Box.Axis, parent: Box.Axis, anchor: number): Box.Axis => {
  const anchorPoint = Scalar.lerp(parent.min, parent.max, anchor)
  return { min: relative.min + anchorPoint, max: relative.max + anchorPoint }
}

/**
 * `calcRelativeBox` undone, on each axis. Placing a child's box relative to its parent into the parent's
 * box as it's animating gives where the child goes, so a child keeps up with its parent whatever their
 * progress.
 */
// Relative projection (ADR-0009, "not left behind").
export const placeRelativeBox = (relative: Box.Box, parent: Box.Box, anchor: Point.Point = { x: 0, y: 0 }): Box.Box => ({
  x: placeRelativeAxis(relative.x, parent.x, anchor.x),
  y: placeRelativeAxis(relative.y, parent.y, anchor.y),
})

/**
 * Which parts of a layout change a node's layout animation animates, as Motion's: `true`, its position
 * and size; `"position"`, its position, its size taking the new one at once; `"size"`, its size; `"x"` or
 * `"y"`, that axis; `"preserve-aspect"`, both while its width-to-height ratio stays within 0.2, else its
 * position.
 */
// A **Layout mode** (CONTEXT.md; ADR-0009, *Amendment (#42)*): Motion's `animationType`.
export type LayoutMode = true | "position" | "size" | "preserve-aspect" | "x" | "y"

/** How far two width/height ratios may be apart for `"preserve-aspect"` to animate both (Motion's `isNear(…, 0.2)`). */
const ASPECT_NEAR = 0.2

/** A box's width/height ratio. */
const aspectOf = (box: Box.Box): number => Box.length(box.x) / Box.length(box.y)

/**
 * Whether `mode` animates only the position of a layout change from `from` to `to`: `"position"`, or
 * `"preserve-aspect"` when their width-to-height ratios are more than 0.2 apart, as Motion's.
 */
// Motion's `shouldAnimatePositionOnly`, create-projection-node.ts:2449-2459 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8. Plain operators: a Follower reads it every frame.
export const animatesPositionOnly = (mode: LayoutMode, from: Box.Box, to: Box.Box): boolean =>
  mode === "position" || (mode === "preserve-aspect" && Math.abs(aspectOf(from) - aspectOf(to)) > ASPECT_NEAR)

/** `box` with `like`'s size, at its own top-left. */
// A Follower's per-frame target: no allocation beyond the box.
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
 * Where a layout animation from `origin` to `target` starts under `mode`, as Motion's: `"size"` moves
 * `origin` to `target`'s top-left, so only its size animates; `"x"` and `"y"` take the other axis from
 * `target`; a position-only mode gives `origin` `target`'s size at its own top-left, so only its position
 * animates; `true` leaves it as it is. Once, at each layout animation's start.
 */
// Motion's `notifyLayoutUpdate`, create-projection-node.ts:2163-2205 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8.
export const shapeOrigin = (mode: LayoutMode, origin: Box.Box, target: Box.Box): Box.Box =>
  Match.value(mode).pipe(
    Match.when("size", () => movedTo(origin, target)),
    Match.when("x", (): Box.Box => ({ x: origin.x, y: target.y })),
    Match.when("y", (): Box.Box => ({ x: target.x, y: origin.y })),
    Match.orElse(() =>
      Bool.match(animatesPositionOnly(mode, origin, target), { onTrue: () => withSizeOf(origin, target), onFalse: () => origin })),
  )

