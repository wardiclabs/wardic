/**
 * Number helpers for animation code: `lerp`, `inverseLerp`, `clamp`, `wrap`, `remap`, `damp` and
 * `snap`. Plain functions on numbers, with no services, so they work anywhere, a frame's step included.
 *
 * @example
 * import * as Scalar from "@wardic/core/Scalar"
 *
 * const scale = Scalar.remap(scrollY, 0, 400, 1, 0.6) // a header that shrinks as the page scrolls
 */
// They run per frame (ADR-0025), so a piecewise result is a statement `if` with an early return. Not
// `Math`, which would hide the global (ADR-0028, decision 12).

/**
 * The point `t` of the way from `a` to `b`: `lerp(0, 100, 0.25)` is 25. `t` isn't clamped, so 1.5
 * goes half as far again past `b`.
 *
 * @example
 * const x = Scalar.lerp(from, to, progress)
 */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * How far `value` is from `a` to `b`, as a fraction: `inverseLerp(0, 100, 25)` is 0.25, the inverse of
 * `lerp`. 0 when `a` and `b` are the same.
 */
export const inverseLerp = (a: number, b: number, value: number): number => {
  if (a === b) return 0
  return (value - a) / (b - a)
}

/** `value` kept within `min` and `max`, both included: `clamp(120, 0, 100)` is 100. */
export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * `value` wrapped round into `min` to `max`, as an angle wraps: `wrap(7, 0, 5)` is 2, `wrap(-1, 0, 5)` is
 * 4. `max` itself wraps to `min`.
 */
export const wrap = (value: number, min: number, max: number): number => {
  const range = max - min
  if (range === 0) return min
  return ((((value - min) % range) + range) % range) + min
}

/**
 * `value` moved from one range onto another: `remap(50, 0, 100, 0, 1)` is 0.5. It isn't clamped, so a
 * value outside the first range lands outside the second; `clamp` the result to keep it in.
 */
export const remap = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => lerp(outMin, outMax, inverseLerp(inMin, inMax, value))

/**
 * One frame's step of a value easing toward `target`, the same at any frame rate: it moves
 * `1 − e^(−lambda · dt)` of the way. `lambda` is how fast, per second; `dt` is the frame's seconds.
 *
 * @example
 * x = Scalar.damp(x, pointerX, 12, dt) // each frame: x trails the pointer
 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt))

/** `value` rounded to the nearest multiple of `step`: `snap(47, 10)` is 50. A `step` of 0 leaves it as it is. */
export const snap = (value: number, step: number): number => {
  if (step === 0) return value
  return Math.round(value / step) * step
}

/** The entry of `points` nearest `value`: `snapTo(130, [0, 100, 250])` is 100. `value` itself when `points` is empty. */
export const snapTo = (value: number, points: ReadonlyArray<number>): number => {
  if (points.length === 0) return value
  let best = points[0]
  let bestDist = Math.abs(value - best)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    const d = Math.abs(value - point)
    if (d < bestDist) {
      best = point
      bestDist = d
    }
  }
  return best
}
