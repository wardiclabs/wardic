import * as Predicate from "effect/Predicate"
import { clamp, lerp } from "../math/index.ts"
import { linear } from "../easing/penner.ts"
import type { DecayOptions, Easing, SpringOptions, TweenOptions } from "../options.ts"

/**
 * Pure, dt-driven step functions — the physics of each primitive with no Effect
 * or Stream involved. These are the frame-level unit-test target; the Stream
 * wrappers in this folder are thin shells over them.
 *
 * Every stepper takes the previous state and a frame delta `dt` (seconds) and
 * returns the next state, the value to emit, and whether motion has settled.
 *
 * The per-frame path (ADR-0025): a primitive resolves its options once, when its stream is
 * built (`resolveTween`, `resolveSpring`, `resolveDecay`), and steps with the resolved form
 * (`stepTween`, `stepSpring`, `stepDecay`), which reads plain fields. `tweenStep`,
 * `springStep` and `decayStep` take the options as written and resolve them on each call, for
 * a caller that steps by hand (`@wardic/dom`'s projection pass).
 */

export interface StepResult<S, V> {
  readonly state: S
  readonly value: V
  readonly done: boolean
}

/**
 * Step result for physics primitives — adds the instantaneous `velocity` the
 * stepper has integrated, so `fromClock` can lift it into a `PhysicsFrame`
 * without each primitive having to reach into the typed state.
 */
export interface PhysicsStepResult<S> extends StepResult<S, number> {
  readonly velocity: number
}

/**
 * An option's value, or its default when it's missing (`undefined` or `null`, as `??` read it).
 * Resolving runs on each call of `tweenStep` / `springStep` / `decayStep`, which a caller may
 * make per frame, so it's an early return, not an `Option`: nothing is allocated (ADR-0025).
 */
const valueOr = <A>(value: A | undefined, fallback: A): A => {
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
  readonly easing: Easing
}

/** Fill in a tween's defaults: no delay, linear easing. */
export const resolveTween = (options: TweenOptions): ResolvedTween => ({
  delay: valueOr(options.delay, 0),
  duration: durationOf(options.duration),
  easing: valueOr(options.easing, linear),
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
  const t = clamp(active / tween.duration, 0, 1)
  const eased = tween.easing(t)
  return { state: { elapsed }, value: lerp(from, to, eased), done: elapsed >= tween.delay + tween.duration }
}

/** One frame of a tween, resolving `options` on the call. */
export const tweenStep = (
  state: TweenState,
  dt: number,
  from: number,
  to: number,
  options: TweenOptions,
): StepResult<TweenState, number> => stepTween(state, dt, from, to, resolveTween(options))

// --- Spring ------------------------------------------------------------------

export interface SpringState {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
}

/** A spring's options with every default filled in, except its start (`initSpring`'s). */
export interface ResolvedSpring {
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
  readonly restDelta: number
  readonly restVelocity: number
  readonly delay: number
}

/** Fill in a spring's defaults: 170 / 26 / 1, rest at 0.01, no delay. */
export const resolveSpring = (options: SpringOptions): ResolvedSpring => ({
  stiffness: valueOr(options.stiffness, 170),
  damping: valueOr(options.damping, 26),
  mass: valueOr(options.mass, 1),
  restDelta: valueOr(options.restDelta, 0.01),
  restVelocity: valueOr(options.restVelocity, 0.01),
  delay: valueOr(options.delay, 0),
})

export const initSpring = (options: SpringOptions): SpringState => ({
  position: valueOr(options.from, 0),
  velocity: valueOr(options.velocity, 0),
  elapsed: 0,
})

const SPRING_SUBSTEP = 1 / 240

/** At rest: slower than `restVelocity`, and nearer the target than `restDelta`. */
const atRest = (position: number, velocity: number, target: number, spring: ResolvedSpring): boolean =>
  Math.abs(velocity) < spring.restVelocity && Math.abs(position - target) < spring.restDelta

/** One frame of a resolved spring. */
export const stepSpring = (
  state: SpringState,
  dt: number,
  target: number,
  spring: ResolvedSpring,
): PhysicsStepResult<SpringState> => {
  const { stiffness, damping, mass } = spring
  const elapsed = state.elapsed + dt
  let position = state.position
  let velocity = state.velocity

  // Only integrate the portion of this frame past the delay.
  const simDt = Math.max(0, Math.min(dt, elapsed - spring.delay))
  if (simDt > 0) {
    const stepCount = Math.max(1, Math.ceil(simDt / SPRING_SUBSTEP))
    const h = simDt / stepCount
    for (let i = 0; i < stepCount; i++) {
      const springForce = -stiffness * (position - target)
      const dampingForce = -damping * velocity
      velocity += ((springForce + dampingForce) / mass) * h
      position += velocity * h
    }
  }

  const settled = simDt > 0 && atRest(position, velocity, target, spring)
  if (settled) {
    position = target
    velocity = 0
  }
  return { state: { position, velocity, elapsed }, value: position, velocity, done: settled }
}

/** One frame of a spring, resolving `options` on the call. */
export const springStep = (
  state: SpringState,
  dt: number,
  target: number,
  options: SpringOptions,
): PhysicsStepResult<SpringState> => stepSpring(state, dt, target, resolveSpring(options))

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

/** One frame of a decay, resolving `options` on the call. */
export const decayStep = (state: DecayState, dt: number, options: DecayOptions): PhysicsStepResult<DecayState> =>
  stepDecay(state, dt, resolveDecay(options))
