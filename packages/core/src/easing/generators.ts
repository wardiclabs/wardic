import bezier from "bezier-easing"
import { clamp } from "../math/index.ts"
import type { Easing } from "../options.ts"

/**
 * A CSS-style cubic-bezier easing through control points (x1, y1, x2, y2).
 * Backed by `bezier-easing`.
 */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number): Easing =>
  bezier(x1, y1, x2, y2)

/** Step position — where the jump happens within each step. */
export type StepPosition = "start" | "end"

/**
 * A stepped easing (CSS `steps()`). `count` discrete steps; `position` controls
 * whether the value jumps at the start or end of each interval.
 */
export const steps = (count: number, position: StepPosition = "end"): Easing => {
  const n = Math.max(1, Math.floor(count))
  return (t) => {
    const clamped = clamp(t, 0, 1)
    const step = position === "start" ? Math.ceil(clamped * n) : Math.floor(clamped * n)
    return clamp(step / n, 0, 1)
  }
}

/** Options shaping a {@link springEasing} curve. */
export interface SpringEasingOptions {
  readonly stiffness?: number
  readonly damping?: number
  readonly mass?: number
}

/**
 * Bakes spring physics into a fixed-duration easing curve normalized to [0, 1].
 *
 * Unlike the live `spring` primitive (which settles to a static target;
 * interruption is the binding's responsibility, and moving-target follow lives
 * in `chase` — see ADR-0001), this is a one-shot easing for cases that need a
 * `(t) => progress` function — the spring is simulated 0 → 1 to rest, then
 * sampled and re-normalized.
 */
export const springEasing = (options: SpringEasingOptions = {}): Easing => {
  const stiffness = options.stiffness ?? 170
  const damping = options.damping ?? 26
  const mass = options.mass ?? 1
  const dt = 1 / 240
  const restDelta = 1e-4
  const restVelocity = 1e-4
  const maxTime = 10

  let position = 0
  let velocity = 0
  let elapsed = 0
  const samples: Array<number> = [0]

  while (elapsed < maxTime) {
    const force = -stiffness * (position - 1)
    const dampingForce = -damping * velocity
    velocity += ((force + dampingForce) / mass) * dt
    position += velocity * dt
    elapsed += dt
    samples.push(position)
    if (Math.abs(velocity) < restVelocity && Math.abs(position - 1) < restDelta) break
  }

  const lastIndex = samples.length - 1
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const idx = t * lastIndex
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, lastIndex)
    const frac = idx - lo
    return samples[lo]! + (samples[hi]! - samples[lo]!) * frac
  }
}
