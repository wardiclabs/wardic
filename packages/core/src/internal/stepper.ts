/**
 * Pure, dt-driven steppers shared by core's modules (ADR-0028, decision 2): the tween's and the
 * decay's, the step results, and `valueOr`. Not importable from outside core (`package.json`'s
 * `"./internal/*": null`); the spring's stepper is public, in the `Spring` module, for dom.
 *
 * Every stepper takes the previous state and a frame delta `dt` (seconds) and returns the next
 * state, the value to emit, and whether motion has settled. The per-frame path (ADR-0025): a
 * machine resolves its options once, when it's built (`resolveTween`, `resolveDecay`), and steps
 * with the resolved form, which reads plain fields.
 */
import * as Predicate from "effect/Predicate"
import * as Easing from "../Easing.ts"
import type { DecayOptions, TweenOptions } from "../Machine.ts"
import * as Scalar from "../Scalar.ts"

/** A step's result: the next state, the value to emit, and whether motion has settled. */
export interface StepResult<S, V> {
  readonly state: S
  readonly value: V
  readonly done: boolean
}

/**
 * Step result for physics primitives — adds the instantaneous `velocity` the
 * stepper has integrated, so a machine's step can lift it into a `Frame.Physics`
 * without each primitive having to reach into the typed state.
 */
export interface PhysicsStepResult<S> extends StepResult<S, number> {
  readonly velocity: number
}

/**
 * An option's value, or its default when it's missing (`undefined` or `null`, as `??` read it).
 * A caller that steps by hand may resolve per frame (dom's projection pass calls
 * `Spring.resolve` per node per frame), so it's an early return, not an `Option`: nothing is
 * allocated (ADR-0025).
 */
export const valueOr = <A>(value: A | undefined, fallback: A): A => {
  if (Predicate.isNullish(value)) return fallback
  return value
}

/** A tween's duration, or `Number.EPSILON` for one at or below 0, so a zero duration still divides. */
const durationOf = (duration: number): number => {
  if (duration <= 0) return Number.EPSILON
  return duration
}

// --- Tween -------------------------------------------------------------------

export interface TweenState {
  readonly elapsed: number
}

/** A tween's options with every default filled in. */
export interface ResolvedTween {
  readonly delay: number
  /** The duration, at least `Number.EPSILON`, so a zero duration still divides. */
  readonly duration: number
  readonly easing: Easing.Easing
}

/** Fill in a tween's defaults: no delay, linear easing. */
export const resolveTween = (options: TweenOptions): ResolvedTween => ({
  delay: valueOr(options.delay, 0),
  duration: durationOf(options.duration),
  easing: valueOr(options.easing, Easing.linear),
})

export const initTween = (): TweenState => ({ elapsed: 0 })

/** One frame of a resolved tween. */
export const stepTween = (
  state: TweenState,
  dt: number,
  from: number,
  to: number,
  tween: ResolvedTween,
): StepResult<TweenState, number> => {
  const elapsed = state.elapsed + dt
  const active = Math.max(0, elapsed - tween.delay)
  const t = Scalar.clamp(active / tween.duration, 0, 1)
  const eased = tween.easing(t)
  return { state: { elapsed }, value: Scalar.lerp(from, to, eased), done: elapsed >= tween.delay + tween.duration }
}

// --- Decay -------------------------------------------------------------------

export interface DecayState {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
}

/** A decay's options with every default filled in. */
export interface ResolvedDecay {
  readonly friction: number
  readonly restVelocity: number
  readonly delay: number
}

/** Fill in a decay's defaults: friction 3, rest below 0.1, no delay. */
export const resolveDecay = (options: DecayOptions): ResolvedDecay => ({
  friction: valueOr(options.friction, 3),
  restVelocity: valueOr(options.restVelocity, 0.1),
  delay: valueOr(options.delay, 0),
})

export const initDecay = (initial: number, velocity: number): DecayState => ({
  position: initial,
  velocity,
  elapsed: 0,
})

/** One frame of a resolved decay. */
export const stepDecay = (state: DecayState, dt: number, decay: ResolvedDecay): PhysicsStepResult<DecayState> => {
  const elapsed = state.elapsed + dt

  let position = state.position
  let velocity = state.velocity
  const simDt = Math.max(0, Math.min(dt, elapsed - decay.delay))
  if (simDt > 0) {
    velocity *= Math.exp(-decay.friction * simDt)
    position += velocity * simDt
  }

  const done = simDt > 0 && Math.abs(velocity) < decay.restVelocity
  return { state: { position, velocity, elapsed }, value: position, velocity, done }
}
