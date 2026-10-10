/**
 * The `Scalar` module: pure math on numbers. No services — usable anywhere. They run per frame
 * (ADR-0025), so a piecewise result is a statement `if` with an early return. Not `Math`, which
 * would hide the global (ADR-0028, decision 12).
 */
import * as Arr from "effect/Array"

/** Linear interpolation from `a` to `b` at `t` (t unclamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Inverse of {@link lerp}: the `t` that produces `value` between `a` and `b`. */
export const inverseLerp = (a: number, b: number, value: number): number => {
  if (a === b) return 0
  return (value - a) / (b - a)
}

/** Clamp `value` into the inclusive range [min, max]. */
export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Wrap `value` into the half-open range [min, max), cycling around.
 * `wrap(7, 0, 5) === 2`, `wrap(-1, 0, 5) === 4`.
 */
export const wrap = (value: number, min: number, max: number): number => {
  const range = max - min
  if (range === 0) return min
  return ((((value - min) % range) + range) % range) + min
}

/** Remap `value` from the [inMin, inMax] range onto [outMin, outMax]. */
export const remap = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => lerp(outMin, outMax, inverseLerp(inMin, inMax, value))

/**
 * Frame-rate-independent damping toward `target`. `lambda` is the smoothing
 * rate (higher = faster); `dt` is the frame delta in seconds.
 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt))

/** Snap `value` to the nearest multiple of `step`. */
export const snap = (value: number, step: number): number => {
  if (step === 0) return value
  return Math.round(value / step) * step
}

/** Snap `value` to the nearest entry in `points`. */
export const snapTo = (value: number, points: ReadonlyArray<number>): number => {
  if (points.length === 0) return value
  let best = Arr.getUnsafe(points, 0)
  let bestDist = Math.abs(value - best)
  for (let i = 1; i < points.length; i++) {
    const point = Arr.getUnsafe(points, i)
    const d = Math.abs(value - point)
    if (d < bestDist) {
      best = point
      bestDist = d
    }
  }
  return best
}
