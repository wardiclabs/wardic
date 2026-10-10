/**
 * The `Spring` module: the spring's presets, and its stepper, `init`, `resolve` and `step`.
 * The stepper is Tier 3 (ADR-0008, ADR-0028 decision 2): `@wardic/dom`'s projection pass steps
 * a progress spring per node per frame with it; everything else runs a spring as a machine
 * (`Machine.spring`, `Machine.springValues`). It's on the per-frame path (ADR-0025).
 */
import type { SpringOptions } from "./Machine.ts"
import { type PhysicsStepResult, valueOr } from "./internal/stepper.ts"

// --- Presets: drop into `Machine.spring(…)` or a `transition`. `gentle` and `stiff` are the
// everyday choices; `wobbly` and `bouncy` overshoot.

export const gentle = { stiffness: 120, damping: 14 } as const satisfies SpringOptions
export const wobbly = { stiffness: 180, damping: 12 } as const satisfies SpringOptions
export const stiff = { stiffness: 210, damping: 20 } as const satisfies SpringOptions
export const slow = { stiffness: 280, damping: 60 } as const satisfies SpringOptions
export const molasses = { stiffness: 280, damping: 120 } as const satisfies SpringOptions
export const bouncy = { stiffness: 400, damping: 10 } as const satisfies SpringOptions

/** A spring's state between steps: where it is, how fast it moves, and how long it has run. */
export interface State {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
}

/** A spring's options with every default filled in, except its start (`init`'s). */
export interface Resolved {
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
  readonly restDelta: number
  readonly restVelocity: number
  readonly delay: number
}

/** Fill in a spring's defaults: 170 / 26 / 1, rest at 0.01, no delay. */
export const resolve = (options: SpringOptions): Resolved => ({
  stiffness: valueOr(options.stiffness, 170),
  damping: valueOr(options.damping, 26),
  mass: valueOr(options.mass, 1),
  restDelta: valueOr(options.restDelta, 0.01),
  restVelocity: valueOr(options.restVelocity, 0.01),
  delay: valueOr(options.delay, 0),
})

/** A spring at rest at `options.from` (default 0), moving at `options.velocity` (default 0). */
export const init = (options: SpringOptions): State => ({
  position: valueOr(options.from, 0),
  velocity: valueOr(options.velocity, 0),
  elapsed: 0,
})

const SPRING_SUBSTEP = 1 / 240

/** At rest: slower than `restVelocity`, and nearer the target than `restDelta`. */
const atRest = (position: number, velocity: number, target: number, spring: Resolved): boolean =>
  Math.abs(velocity) < spring.restVelocity && Math.abs(position - target) < spring.restDelta

/**
 * One frame of a resolved spring toward `target`. Only the part of `dt` past the spring's
 * `delay` is integrated, in substeps of at most 1/240 s; it settles at rest within `restDelta`
 * and `restVelocity`, landing exactly on `target`. A caller stepping by hand per frame resolves
 * its options with `resolve`.
 */
export const step = (state: State, dt: number, target: number, spring: Resolved): PhysicsStepResult<State> => {
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
