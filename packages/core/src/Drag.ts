/**
 * The `Drag` module: a drag gesture's `Sample`, its `Axis`, a constraint on one value (`constrain`),
 * the shaping combinator over a stream of them (`withinBounds`, `dual`, the stream first), and the
 * bounds an element constraint makes (`boundsWithin`, `keepPlace`, #273).
 * `Recognizer.drag` recognizes the gesture, kept
 * to its `axis` (ADR-0019, *Amendment (#29)*); a binding composes its response, the Fling included
 * (ADR-0004, *Amendment (#32)*).
 */
import * as Bool from "effect/Boolean"
import { dual } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Stream from "effect/Stream"
import type * as Point from "./Point.ts"

/**
 * One emission from the `Recognizer.drag` recognizer — an Effect-free, portable signal.
 *
 * - `point`: the current pointer position (environment coordinates).
 * - `offset`: `point - origin`, measured from the down-point that started the
 *   gesture (total displacement of the drag).
 * - `delta`: `point - lastPoint`, the change since the previous emitted event.
 * - `velocity`: the pointer's, per axis in units per second, over the gesture's last 100 ms
 *   (Motion's `getVelocity`); the `"end"` sample counts the release point, so a pause before
 *   letting go weakens it, down to none.
 * - `phase`: `"start"` on activation, `"move"` while dragging, `"end"` on
 *   release/cancel. A cancel ends at the last move's point with the moves' velocity
 *   (a `pointercancel`'s own coordinates aren't the pointer's: Chromium's carries
 *   (0, 0)). A **Stale gesture** (its release was lost, ADR-0019) also ends:
 *   at the owning pointer's first move with no button pressed, or its next down,
 *   with an `"end"` at the last pressed point, no delta and no velocity.
 * - `timeStamp`: the time (ms) of the event that produced it (a scroll-driven move
 *   carries the scroll's; a Stale gesture's end carries the event that ended it).
 * - `scroll`: the scroll the hold has counted into `point` since the down (the event's,
 *   `InputSource.PointerLikeEvent.scroll`): `point - scroll` is where the pointer is on
 *   the screen (#257).
 * - `raw`: the platform's own event behind it (`InputSource.PointerLikeEvent.raw`, #273),
 *   opaque to core: a binding hands it to an app's drag callback.
 * - `axis`: the axes the gesture moves on, read at its start (#273): its drag's axis, or a
 *   direction-locked drag's lock. A pan's are both.
 */
export interface Sample {
  readonly point: Point.Point
  readonly offset: Point.Point
  readonly delta: Point.Point
  readonly velocity: Point.Point
  readonly phase: "start" | "move" | "end"
  readonly timeStamp: number
  readonly scroll: Point.Point
  readonly raw?: unknown
  readonly axis: Axis
}

/**
 * A single-axis constraint on `offset`. Both bounds are optional, so a range can
 * be open on either side (`{ min: 0 }` clamps below 0 but allows any positive
 * offset). An `undefined` axis range passes that axis through untouched.
 */
export interface AxisRange {
  readonly min?: number
  readonly max?: number
}

/**
 * Per-axis constraints applied to a `Sample`'s `offset`. Either axis may be
 * omitted to leave it unconstrained.
 */
export interface Bounds {
  readonly x?: AxisRange
  readonly y?: AxisRange
}

/**
 * The axes a drag moves on: `"x"` or `"y"` alone, or `"xy"` for a free drag. `Recognizer.drag`'s
 * `axis` zeroes a one-axis drag's off-axis and claims only its axis (a **Drag claim**, ADR-0019,
 * *Amendment (#29)*).
 */
export type Axis = "x" | "y" | "xy"

/** `v` past the range's `min`, pulled back toward it by `elastic`; `None` within it. */
const belowMin = (v: number, range: AxisRange, elastic: number): Option.Option<number> =>
  Option.fromNullishOr(range.min).pipe(
    Option.filter((min) => v < min),
    Option.map((min) => min - (min - v) * elastic),
  )

/** `v` past the range's `max`, pulled back toward it by `elastic`; `None` within it. */
const aboveMax = (v: number, range: AxisRange, elastic: number): Option.Option<number> =>
  Option.fromNullishOr(range.max).pipe(
    Option.filter((max) => v > max),
    Option.map((max) => max + (v - max) * elastic),
  )

/**
 * Constrain a single scalar to `range` with optional `elastic` resistance (Motion's
 * `applyConstraints`).
 *
 * - No `range`: pass through.
 * - Below `range.min`: `min - (min - v) * elastic`.
 * - Above `range.max`: `max + (v - max) * elastic`.
 * - In range: unchanged.
 *
 * So `elastic = 0` is a hard clamp (snaps to the bound) and `elastic = 1` is
 * free (no resistance — the value passes through). Values in `(0, 1)` rubber-
 * band: the overshoot past the bound is scaled by `elastic`.
 *
 * Positional: a drag whose constraints bound the element's x/y applies it where the
 * gesture's offset meets where the element started (ADR-0016, *Amendment (#140)*).
 *
 * @example
 * Drag.constrain(130, { min: 0, max: 100 }, 0.35) // 110.5
 */
export const constrain = (v: number, range: AxisRange | undefined, elastic: number): number =>
  Option.fromUndefinedOr(range).pipe(
    Option.flatMap((r) => Option.orElse(belowMin(v, r, elastic), () => aboveMax(v, r, elastic))),
    Option.getOrElse(() => v),
  )

/** A box's edges, in its Environment's coordinates (a `Probe.Bounds` is one). */
export interface Edges {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** One axis of {@link boundsWithin}: from the container's near edge less the box's, to its far edge less the box's; swapped when the box is bigger. */
const rangeWithin = (near: number, far: number, containerNear: number, containerFar: number): AxisRange => {
  const min = containerNear - near
  const max = containerFar - far
  if (containerFar - containerNear < far - near) return { min: max, max: min }
  return { min, max }
}

/**
 * The bounds on an element's x/y that keep its box `own` inside `container` (#273, ADR-0047, Motion's
 * `calcViewportConstraints`): per axis, from `container`'s near edge less `own`'s to its far edge less
 * `own`'s. On an axis where `own` is the bigger, they swap, so it can be dragged to show what overflows
 * and no further. `own` is the element's box with no x/y of its own: its layout box.
 */
export const boundsWithin = (own: Edges, container: Edges): Bounds => ({
  x: rangeWithin(own.left, own.right, container.left, container.right),
  y: rangeWithin(own.top, own.bottom, container.top, container.bottom),
})

/** Whether two ranges are the same: each edge equal, or absent in both. */
const sameRange = (a: AxisRange | undefined, b: AxisRange | undefined): boolean =>
  UndefinedOr.match(a, {
    onUndefined: () => Predicate.isUndefined(b),
    onDefined: (ra) => UndefinedOr.match(b, { onUndefined: () => false, onDefined: (rb) => Bool.and(ra.min === rb.min, ra.max === rb.max) }),
  })

/** Whether two bounds are the same, axis by axis (#273): a resize that changed neither leaves an element where it is. */
export const sameBounds = (a: Bounds, b: Bounds): boolean => Bool.and(sameRange(a.x, b.x), sameRange(a.y, b.y))

/**
 * Where `value` sits within `min`..`max` (Motion's `calcOrigin` for a point): 0 at `min`, 1 at `max`,
 * clamped; ½ for a range of no length.
 */
export const progressWithin = (value: number, min: number, max: number): number => {
  if (max === min) return 0.5
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

/** A range's two edges, when it has both. */
const edgesOfRange = (range: AxisRange | undefined): Option.Option<readonly [number, number]> =>
  Option.fromUndefinedOr(range).pipe(Option.flatMap((r) => Option.all([Option.fromUndefinedOr(r.min), Option.fromUndefinedOr(r.max)] as const)))

/** One axis of {@link keepPlace}: `value` at its place in `from`, within `to`, if both have both edges. */
const keptOn = (value: number, from: AxisRange | undefined, to: AxisRange | undefined): number =>
  Option.match(Option.all([edgesOfRange(from), edgesOfRange(to)] as const), {
    onNone: () => value,
    onSome: ([[fromMin, fromMax], [toMin, toMax]]) => toMin + progressWithin(value, fromMin, fromMax) * (toMax - toMin),
  })

/**
 * `position` moved to keep its place in `from` within `to` (#273, Motion's
 * `scalePositionWithinConstraints`): an element constraint's bounds after a resize. Only on the axes
 * `axis` moves, and where both bounds have both edges; elsewhere it stays.
 */
export const keepPlace = (position: Point.Point, axis: Axis, from: Bounds, to: Bounds): Point.Point => ({
  x: Bool.match(axis === "y", { onTrue: () => position.x, onFalse: () => keptOn(position.x, from.x, to.x) }),
  y: Bool.match(axis === "x", { onTrue: () => position.y, onFalse: () => keptOn(position.y, from.y, to.y) }),
})

/**
 * `sample` with its `offset` constrained to a static numeric region, per axis, with optional
 * `elastic` rubber-band resistance past the bounds (`elastic` defaults to `0`, a hard clamp). An
 * omitted axis range passes that axis through; `delta` and `velocity` are left as they are, as
 * {@link withinBounds} leaves them. `dual`, the sample first: for a watch's samples (#379), one
 * at a time, where {@link withinBounds} shapes a Stream's.
 */
export const within: {
  (bounds: Bounds, options?: { readonly elastic?: number }): (sample: Sample) => Sample
  (sample: Sample, bounds: Bounds, options?: { readonly elastic?: number }): Sample
} = dual(
  (args) => Predicate.hasProperty(args[0], "phase"),
  (sample: Sample, bounds: Bounds, options: { readonly elastic?: number } = {}): Sample => {
    const elastic = Option.getOrElse(Option.fromNullishOr(options.elastic), () => 0)
    return {
      ...sample,
      offset: {
        x: constrain(sample.offset.x, bounds.x, elastic),
        y: constrain(sample.offset.y, bounds.y, elastic),
      },
    }
  },
)

/**
 * Constrain a drag's `offset` to a static numeric region, per axis, with
 * optional `elastic` rubber-band resistance past the bounds (`elastic` defaults
 * to `0` — a hard clamp). An omitted axis range passes that axis through.
 *
 * Pure and stateless: a `Stream.map` of {@link within}, `dual`, the stream first, that preserves the source
 * stream's `E`/`R` (Probe-free per ADR-0004 — this is the numeric form, not the
 * element-relative one).
 *
 * Only `offset` is transformed. `delta` and `velocity` are intentionally left
 * as the raw pointer-derived values: the binding positions the element from
 * `offset`, while `delta`/`velocity` remain a faithful record of pointer motion
 * (keeping the combinator pure and stateless — clamping them would require
 * tracking prior emitted state).
 *
 * @example
 * Recognizer.drag(el).pipe(Drag.withinBounds({ x: { min: 0, max: 200 } }, { elastic: 0.5 }))
 */
export const withinBounds: {
  (
    bounds: Bounds,
    options?: { readonly elastic?: number },
  ): <E, R>(stream: Stream.Stream<Sample, E, R>) => Stream.Stream<Sample, E, R>
  <E, R>(
    stream: Stream.Stream<Sample, E, R>,
    bounds: Bounds,
    options?: { readonly elastic?: number },
  ): Stream.Stream<Sample, E, R>
} = dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(
    stream: Stream.Stream<Sample, E, R>,
    bounds: Bounds,
    options: { readonly elastic?: number } = {},
  ): Stream.Stream<Sample, E, R> => Stream.map(stream, (sample) => within(sample, bounds, options)),
)
