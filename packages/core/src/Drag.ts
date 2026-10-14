/**
 * The `Drag` module: a drag gesture's `Sample`, its `Axis`, a constraint on one value (`constrain`),
 * and the shaping combinator over a stream of them (`withinBounds`, `dual`, the stream first).
 * `Recognizer.drag` recognizes the gesture, kept
 * to its `axis` (ADR-0019, *Amendment (#29)*); a binding composes its response, the Fling included
 * (ADR-0004, *Amendment (#32)*).
 */
import { dual } from "effect/Function"
import * as Option from "effect/Option"
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
 */
export interface Sample {
  readonly point: Point.Point
  readonly offset: Point.Point
  readonly delta: Point.Point
  readonly velocity: Point.Point
  readonly phase: "start" | "move" | "end"
  readonly timeStamp: number
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

/**
 * Constrain a drag's `offset` to a static numeric region, per axis, with
 * optional `elastic` rubber-band resistance past the bounds (`elastic` defaults
 * to `0` — a hard clamp). An omitted axis range passes that axis through.
 *
 * Pure and stateless: a `Stream.map`, `dual`, the stream first, that preserves the source
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
  ): Stream.Stream<Sample, E, R> => {
    const elastic = Option.getOrElse(Option.fromNullishOr(options.elastic), () => 0)
    return Stream.map(stream, (sample) => ({
      ...sample,
      offset: {
        x: constrain(sample.offset.x, bounds.x, elastic),
        y: constrain(sample.offset.y, bounds.y, elastic),
      },
    }))
  },
)
