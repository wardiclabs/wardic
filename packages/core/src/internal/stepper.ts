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
import { cachedResolver, field, Fn, NonNegative, Positive } from "./options.ts"

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

/** A tween's duration when its options give none: 0.3 s (#107). */
export const DEFAULT_DURATION = 0.3

/** A tween's duration, or `Number.EPSILON` for one at or below 0, so a zero duration still divides. */
export const durationOf = (duration: number): number => {
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
  /** The duration as given (0 for an instant tween): its span's, and what `keyframes` splits. */
  readonly seconds: number
  readonly easing: Easing.Easing
}

/** A tween's fields as a Schema (#66): `animate`'s bag adds its repeat modifiers to them. */
export const TweenFields = {
  delay: field(NonNegative, 0),
  duration: field(NonNegative, DEFAULT_DURATION),
  easing: field(Fn<Easing.Easing>("an easing function"), Easing.linear),
}

/** A decoded tween's fields, resolved: its duration clamped for division, as given beside it. */
export const resolvedTweenOf = (decoded: { readonly delay: number; readonly duration: number; readonly easing: Easing.Easing }): ResolvedTween => ({
  delay: decoded.delay,
  duration: durationOf(decoded.duration),
  seconds: decoded.duration,
  easing: decoded.easing,
})

/**
 * Fill in a tween's defaults: 0.3 s, no delay, linear easing. Decoded once a bag (#66): a negative
 * or non-finite duration or delay, or an easing that isn't a function, throws its `SchemaError`.
 * Public as `Machine.resolveTween`, Tier 3, for dom's layout tween.
 */
export const resolveTween: (options: TweenOptions) => ResolvedTween = cachedResolver(TweenFields, resolvedTweenOf)

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

/**
 * Fill in a decay's defaults: friction 3, rest below 0.1, no delay. Decoded once a bag (#66): a
 * friction or rest speed at or below 0, or a non-finite value, throws its `SchemaError`.
 */
export const resolveDecay: (options: DecayOptions) => ResolvedDecay = cachedResolver(
  {
    friction: field(Positive, 3),
    restVelocity: field(Positive, 0.1),
    delay: field(NonNegative, 0),
  },
  ({ friction, restVelocity, delay }): ResolvedDecay => ({ friction, restVelocity, delay }),
)

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
