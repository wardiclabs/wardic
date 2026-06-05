import * as Stream from "effect/Stream"
import type { DragSample } from "./drag.ts"

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
 * Per-axis constraints applied to a `DragSample`'s `offset`. Either axis may be
 * omitted to leave it unconstrained.
 */
export interface DragBounds {
  readonly x?: AxisRange
  readonly y?: AxisRange
}

/** The axis a drag is locked to; the other axis is zeroed. */
type Axis = "x" | "y"

/**
 * Lock a drag to a single `axis`, zeroing the off-axis component of `offset`,
 * `delta`, and `velocity` so the element only moves along `axis`. `point` (the
 * true pointer position) and `phase` are left unchanged.
 *
 * Pure and stateless: a curried `Stream.map` that preserves the source stream's
 * `E`/`R`, so it pipes directly over `drag`'s output without widening its
 * dependency surface (see ADR-0004 — shaping combinators stay Probe-free).
 *
 * @example
 * drag(el).pipe(axisLock("x")) // offset.y, delta.y, velocity.y forced to 0
 */
export const axisLock =
  (axis: Axis) =>
  <E, R>(stream: Stream.Stream<DragSample, E, R>): Stream.Stream<DragSample, E, R> => {
    const off: Axis = axis === "x" ? "y" : "x"
    return Stream.map(stream, (sample) => ({
      ...sample,
      offset: { ...sample.offset, [off]: 0 },
      delta: { ...sample.delta, [off]: 0 },
      velocity: { ...sample.velocity, [off]: 0 },
    }))
  }

/**
 * Constrain a single scalar to `range` with optional `elastic` resistance.
 *
 * - No `range`: pass through.
 * - Below `range.min`: `min - (min - v) * elastic`.
 * - Above `range.max`: `max + (v - max) * elastic`.
 * - In range: unchanged.
 *
 * So `elastic = 0` is a hard clamp (snaps to the bound) and `elastic = 1` is
 * free (no resistance — the value passes through). Values in `(0, 1)` rubber-
 * band: the overshoot past the bound is scaled by `elastic`.
 */
const constrain = (v: number, range: AxisRange | undefined, elastic: number): number => {
  if (range === undefined) return v
  if (range.min != null && v < range.min) return range.min - (range.min - v) * elastic
  if (range.max != null && v > range.max) return range.max + (v - range.max) * elastic
  return v
}

/**
 * Constrain a drag's `offset` to a static numeric region, per axis, with
 * optional `elastic` rubber-band resistance past the bounds (`elastic` defaults
 * to `0` — a hard clamp). An omitted axis range passes that axis through.
 *
 * Pure and stateless: a curried `Stream.map` that preserves the source stream's
 * `E`/`R` (Probe-free per ADR-0004 — this is the numeric form, not the
 * element-relative one).
 *
 * Only `offset` is transformed. `delta` and `velocity` are intentionally left
 * as the raw pointer-derived values: the binding positions the element from
 * `offset`, while `delta`/`velocity` remain a faithful record of pointer motion
 * (keeping the combinator pure and stateless — clamping them would require
 * tracking prior emitted state).
 *
 * @example
 * drag(el).pipe(withinBounds({ x: { min: 0, max: 200 } }, { elastic: 0.5 }))
 */
export const withinBounds =
  (bounds: DragBounds, options?: { readonly elastic?: number }) =>
  <E, R>(stream: Stream.Stream<DragSample, E, R>): Stream.Stream<DragSample, E, R> => {
    const elastic = options?.elastic ?? 0
    return Stream.map(stream, (sample) => ({
      ...sample,
      offset: {
        x: constrain(sample.offset.x, bounds.x, elastic),
        y: constrain(sample.offset.y, bounds.y, elastic),
      },
    }))
  }
