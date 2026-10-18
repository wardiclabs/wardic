/**
 * The `Easing` module: an easing maps normalized time `t` in [0, 1] to eased progress. The
 * Penner set (names kept), `cubicBezier`, `steps`, and `spring`, a spring baked into a curve.
 * Plain functions callers write as well as take (`(t) => t * t`), so no prototype (ADR-0028,
 * decision 1); every easing runs per frame (ADR-0025).
 */
import bezier from "bezier-easing"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"

/** Easing function mapping normalized time `t` in [0, 1] to eased progress. */
export type Easing = (t: number) => number

/**
 * The standard Penner easing set, normalized to `t` in [0, 1].
 * `easeOutX` is the most useful family for UI; `easeInOutX` for symmetric motion.
 *
 * Every easing runs per frame (ADR-0025): a piecewise curve is a statement `if` per piece,
 * with an early return, not a ternary or a match.
 */

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5

export const linear: Easing = (t) => t

export const easeInQuad: Easing = (t) => t * t
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t)
export const easeInOutQuad: Easing = (t) => {
  if (t < 0.5) return 2 * t * t
  return 1 - Math.pow(-2 * t + 2, 2) / 2
}

export const easeInCubic: Easing = (t) => t * t * t
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic: Easing = (t) => {
  if (t < 0.5) return 4 * t * t * t
  return 1 - Math.pow(-2 * t + 2, 3) / 2
}

export const easeInQuart: Easing = (t) => t * t * t * t
export const easeOutQuart: Easing = (t) => 1 - Math.pow(1 - t, 4)
export const easeInOutQuart: Easing = (t) => {
  if (t < 0.5) return 8 * t * t * t * t
  return 1 - Math.pow(-2 * t + 2, 4) / 2
}

export const easeInQuint: Easing = (t) => t * t * t * t * t
export const easeOutQuint: Easing = (t) => 1 - Math.pow(1 - t, 5)
export const easeInOutQuint: Easing = (t) => {
  if (t < 0.5) return 16 * t * t * t * t * t
  return 1 - Math.pow(-2 * t + 2, 5) / 2
}

export const easeInSine: Easing = (t) => 1 - Math.cos((t * Math.PI) / 2)
export const easeOutSine: Easing = (t) => Math.sin((t * Math.PI) / 2)
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2

export const easeInExpo: Easing = (t) => {
  if (t === 0) return 0
  return Math.pow(2, 10 * t - 10)
}
export const easeOutExpo: Easing = (t) => {
  if (t === 1) return 1
  return 1 - Math.pow(2, -10 * t)
}
export const easeInOutExpo: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2
  return (2 - Math.pow(2, -20 * t + 10)) / 2
}

export const easeInCirc: Easing = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2))
export const easeOutCirc: Easing = (t) => Math.sqrt(1 - Math.pow(t - 1, 2))
export const easeInOutCirc: Easing = (t) => {
  if (t < 0.5) return (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
  return (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2
}

export const easeInBack: Easing = (t) => c3 * t * t * t - c1 * t * t
export const easeOutBack: Easing = (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
export const easeInOutBack: Easing = (t) => {
  if (t < 0.5) return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
  return (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
}

export const easeInElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
}
export const easeOutElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
export const easeInOutElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  if (t < 0.5) return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
}

export const easeOutBounce: Easing = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
export const easeInBounce: Easing = (t) => 1 - easeOutBounce(1 - t)
export const easeInOutBounce: Easing = (t) => {
  if (t < 0.5) return (1 - easeOutBounce(1 - 2 * t)) / 2
  return (1 + easeOutBounce(2 * t - 1)) / 2
}

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
    const clamped = Scalar.clamp(t, 0, 1)
    const step = round(clamped * n)
    return Scalar.clamp(step / n, 0, 1)
  }
}

/**
 * Options shaping a {@link spring} curve: its `stiffness`, `damping` and `mass`. The bag is a spring's
 * (`Spring.resolve` decodes it, #225), so a spring's other fields may come with it, and are checked,
 * but don't shape the curve.
 */
export interface SpringOptions {
  readonly stiffness?: number
  readonly damping?: number
  readonly mass?: number
}

/** No options: the spring's defaults, one bag, so its decode is cached (#66). */
const NO_SPRING: SpringOptions = {}

/** The unit spring `spring` samples, between two of its 1/240 s steps. */
interface SpringSim {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
  readonly rested: boolean
}

/**
 * Bakes spring physics into a fixed-duration easing curve normalized to [0, 1].
 *
 * Unlike the live `Machine.spring` primitive (which settles to a static target;
 * interruption is the binding's responsibility, and moving-target follow lives
 * in `chase` — see ADR-0001), this is a one-shot easing for cases that need a
 * `(t) => progress` function — the spring is simulated 0 → 1 to rest, then
 * sampled and re-normalized.
 *
 * Its bag is decoded as every spring bag is (`Spring.resolve`, #225, ADR-0025 *Amendment (#225)*), when
 * it's called: a value no spring can take (a stiffness or mass at or below 0, a negative damping, NaN,
 * Infinity) throws its `SchemaError`, naming the field. Only `stiffness`, `damping` and `mass` shape
 * the curve; it bakes its own rest thresholds and step.
 */
export const spring = (options: SpringOptions = NO_SPRING): Easing => {
  const { stiffness, damping, mass } = Spring.resolve(options)
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
    const from = samples[lo]
    return from + (samples[hi] - from) * frac
  }
}
