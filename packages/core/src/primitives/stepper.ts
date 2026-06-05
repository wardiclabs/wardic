import { clamp, lerp } from "../math/index.ts"
import { linear } from "../easing/penner.ts"
import type { DecayOptions, SpringOptions, TweenOptions } from "../options.ts"

/**
 * Pure, dt-driven step functions — the physics of each primitive with no Effect
 * or Stream involved. These are the frame-level unit-test target; the Stream
 * wrappers in this folder are thin shells over them.
 *
 * Every stepper takes the previous state and a frame delta `dt` (seconds) and
 * returns the next state, the value to emit, and whether motion has settled.
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

// --- Tween -------------------------------------------------------------------

export interface TweenState {
  readonly elapsed: number
}

export const initTween = (): TweenState => ({ elapsed: 0 })

export const tweenStep = (
  state: TweenState,
  dt: number,
  from: number,
  to: number,
  options: TweenOptions,
): StepResult<TweenState, number> => {
  const elapsed = state.elapsed + dt
  const delay = options.delay ?? 0
  const duration = options.duration <= 0 ? Number.EPSILON : options.duration
  const active = Math.max(0, elapsed - delay)
  const t = clamp(active / duration, 0, 1)
  const eased = (options.easing ?? linear)(t)
  return { state: { elapsed }, value: lerp(from, to, eased), done: elapsed >= delay + duration }
}

// --- Spring ------------------------------------------------------------------

export interface SpringState {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
}

export const initSpring = (options: SpringOptions): SpringState => ({
  position: options.from ?? 0,
  velocity: options.velocity ?? 0,
  elapsed: 0,
})

const SPRING_SUBSTEP = 1 / 240

export const springStep = (
  state: SpringState,
  dt: number,
  target: number,
  options: SpringOptions,
): PhysicsStepResult<SpringState> => {
  const stiffness = options.stiffness ?? 170
  const damping = options.damping ?? 26
  const mass = options.mass ?? 1
  const restDelta = options.restDelta ?? 0.01
  const restVelocity = options.restVelocity ?? 0.01
  const delay = options.delay ?? 0

  const elapsed = state.elapsed + dt
  let position = state.position
  let velocity = state.velocity

  // Only integrate the portion of this frame past the delay.
  const simDt = Math.max(0, Math.min(dt, elapsed - delay))
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

  const settled =
    simDt > 0 && Math.abs(velocity) < restVelocity && Math.abs(position - target) < restDelta
  if (settled) {
    position = target
    velocity = 0
  }
  return { state: { position, velocity, elapsed }, value: position, velocity, done: settled }
}

// --- Decay -------------------------------------------------------------------

export interface DecayState {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
}

export const initDecay = (initial: number, velocity: number): DecayState => ({
  position: initial,
  velocity,
  elapsed: 0,
})

export const decayStep = (
  state: DecayState,
  dt: number,
  options: DecayOptions,
): PhysicsStepResult<DecayState> => {
  const friction = options.friction ?? 3
  const restVelocity = options.restVelocity ?? 0.1
  const delay = options.delay ?? 0
  const elapsed = state.elapsed + dt

  let position = state.position
  let velocity = state.velocity
  const simDt = Math.max(0, Math.min(dt, elapsed - delay))
  if (simDt > 0) {
    velocity *= Math.exp(-friction * simDt)
    position += velocity * simDt
  }

  const done = simDt > 0 && Math.abs(velocity) < restVelocity
  return { state: { position, velocity, elapsed }, value: position, velocity, done }
}
