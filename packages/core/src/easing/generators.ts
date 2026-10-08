import bezier from "bezier-easing"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
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
  // Chosen once, so the easing itself, which runs per frame, only rounds (ADR-0025).
  const round = Bool.match(position === "start", { onTrue: () => Math.ceil, onFalse: () => Math.floor })
  return (t) => {
    const clamped = clamp(t, 0, 1)
    const step = round(clamped * n)
    return clamp(step / n, 0, 1)
  }
}

/** Options shaping a {@link springEasing} curve. */
export interface SpringEasingOptions {
  readonly stiffness?: number
  readonly damping?: number
  readonly mass?: number
}

/** The unit spring `springEasing` samples, between two of its 1/240 s steps. */
interface SpringSim {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
  readonly rested: boolean
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
  const stiffness = Option.getOrElse(Option.fromNullishOr(options.stiffness), () => 170)
  const damping = Option.getOrElse(Option.fromNullishOr(options.damping), () => 26)
  const mass = Option.getOrElse(Option.fromNullishOr(options.mass), () => 1)
  const dt = 1 / 240
  const restDelta = 1e-4
  const restVelocity = 1e-4
  const maxTime = 10

  /** One step of the unit spring, or `None` once it has come to rest or run out of time. */
  const advance = (sim: SpringSim): Option.Option<readonly [number, SpringSim]> =>
    Option.liftPredicate(sim, (s) => Bool.and(!s.rested, s.elapsed < maxTime)).pipe(
      Option.map((s) => {
        const force = -stiffness * (s.position - 1)
        const dampingForce = -damping * s.velocity
        const velocity = s.velocity + ((force + dampingForce) / mass) * dt
        const position = s.position + velocity * dt
        const rested = Bool.and(Math.abs(velocity) < restVelocity, Math.abs(position - 1) < restDelta)
        return [position, { position, velocity, elapsed: s.elapsed + dt, rested }] as const
      }),
    )
  const samples = Arr.prepend(Arr.unfold({ position: 0, velocity: 0, elapsed: 0, rested: false }, advance), 0)

  const lastIndex = samples.length - 1
  // Per frame (ADR-0025): early returns, and indexes in range by construction.
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const idx = t * lastIndex
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, lastIndex)
    const frac = idx - lo
    const from = Arr.getUnsafe(samples, lo)
    return from + (Arr.getUnsafe(samples, hi) - from) * frac
  }
}
