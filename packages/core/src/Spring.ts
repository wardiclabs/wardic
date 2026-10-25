/**
 * The `Spring` module: the spring's presets, and its stepper, `init`, `resolve` and `step`.
 * The stepper is Tier 3 (ADR-0008, ADR-0028 decision 2): `@wardic/dom`'s projection pass steps
 * a progress spring per node per frame with it; everything else runs a spring as a machine
 * (`Machine.spring`, `Machine.springValues`). It's on the per-frame path (ADR-0025).
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import type { SpringOptions } from "./Machine.ts"
import { cachedResolver, field, NonNegative, optionalField, Positive } from "./internal/options.ts"
import type { PhysicsStepResult } from "./internal/stepper.ts"

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

/**
 * A spring's options with every default filled in, except its start (`init`'s) and its rest
 * thresholds: those given are kept, and the rest are a leg's, by its distance ({@link restFor}).
 */
export interface Resolved {
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
  /** The rest threshold for the distance to the target, if given: else by distance ({@link restFor}). */
  readonly restDelta: number | undefined
  /** The rest threshold for the speed, per second, if given: else by distance ({@link restFor}). */
  readonly restSpeed: number | undefined
  readonly delay: number
}

/** A leg's rest thresholds (#344): at rest within `delta` of its target and `speed` per second. */
export interface Rest {
  readonly delta: number
  readonly speed: number
}

/**
 * A spring's options as a Schema (#66, ADR-0025 *Amendment (#66)*): the plain bag is its encoded
 * side, checked field by field, each default filled in after. `from` and `velocity` are `init`'s,
 * checked here.
 */
const Options = {
  stiffness: field(Positive, 170),
  damping: field(NonNegative, 26),
  mass: field(Positive, 1),
  restDelta: optionalField(Positive),
  restSpeed: optionalField(Positive),
  delay: field(NonNegative, 0),
  from: optionalField(Schema.Finite),
  velocity: optionalField(Schema.Finite),
}

/**
 * Fill in a spring's defaults: 170 / 26 / 1, no delay, and its rest thresholds as given (else a
 * leg's, by its distance: {@link restFor}). Decoded once a bag (#66): a value no spring can take (a
 * stiffness or mass at or below 0, a negative damping, NaN, Infinity) throws its `SchemaError`,
 * naming the field.
 */
export const resolve: (options: SpringOptions) => Resolved = cachedResolver(
  Options,
  ({ stiffness, damping, mass, restDelta, restSpeed, delay }): Resolved => ({ stiffness, damping, mass, restDelta, restSpeed, delay }),
)

/**
 * Motion's default rest thresholds (#344, `motion-dom` `spring.ts`'s `springDefaults` at
 * `16c6122`): for a leg of 5 or more, 0.5 and 2 per second; for one shorter (opacity, scale, a
 * nudge: "granular"), 0.005 and 0.01.
 */
/** Under this distance a leg is granular (#344): Motion's `isGranularScale`. */
export const GRANULAR = 5
const REST_DELTA = 0.5
const REST_SPEED = 2
const GRANULAR_REST_DELTA = 0.005
const GRANULAR_REST_SPEED = 0.01

/**
 * A leg's rest thresholds (#344), as Motion's are: each given one, else by how far the leg goes,
 * `distance` (its target less its start), in the spring's units. A spring stepped on a progress of
 * its own (a layout animation's, 0 → 1) passes the distance Motion's progress spans (1000), and
 * that as `scale`: its thresholds, given ones among them, are read in Motion's units and divided
 * by it. Called at a leg's start, and again at each new target: never per frame.
 */
export const restFor = (spring: Resolved, distance: number, scale = 1): Rest => ({
  delta: restDeltaFor(spring, distance, scale),
  speed: restSpeedFor(spring, distance, scale),
})

/** {@link restFor}'s `delta` alone: allocation-free, for a run that keeps its keys' thresholds in arrays. */
export const restDeltaFor = (spring: Resolved, distance: number, scale = 1): number =>
  thresholdOf(spring.restDelta, distance, GRANULAR_REST_DELTA, REST_DELTA) / scale

/** {@link restFor}'s `speed` alone: allocation-free. */
export const restSpeedFor = (spring: Resolved, distance: number, scale = 1): number =>
  thresholdOf(spring.restSpeed, distance, GRANULAR_REST_SPEED, REST_SPEED) / scale

/** A threshold given, else the granular one for a leg under {@link GRANULAR}, else the coarse one. Plain reads: a Retarget runs it per key. */
const thresholdOf = (given: number | undefined, distance: number, granular: number, coarse: number): number => {
  if (Predicate.isNotUndefined(given)) return given
  if (Math.abs(distance) < GRANULAR) return granular
  return coarse
}

/** A missing `from` or `velocity`: 0. */
const ZERO = { onUndefined: () => 0, onDefined: (n: number) => n }

/**
 * A spring at rest at `options.from` (default 0), moving at `options.velocity` (default 0). Read
 * through `UndefinedOr`, so this module loads nothing of `internal/stepper.ts`, which loads `Easing`:
 * `Easing.spring` decodes its bag here (#225).
 */
export const init = (options: SpringOptions): State => ({
  position: UndefinedOr.match(options.from, ZERO),
  velocity: UndefinedOr.match(options.velocity, ZERO),
  elapsed: 0,
})

const SPRING_SUBSTEP = 1 / 240

/** At rest (#344, as Motion's): no faster than `rest.speed`, and no farther from the target than `rest.delta`. */
const atRest = (position: number, velocity: number, target: number, rest: Rest): boolean =>
  Math.abs(velocity) <= rest.speed && Math.abs(position - target) <= rest.delta

/**
 * One frame of a resolved spring toward `target`. Only the part of `dt` past the spring's
 * `delay` is integrated, in substeps of at most 1/240 s; it settles at rest within `rest` (the
 * leg's, from {@link restFor}), landing exactly on `target`. A caller stepping by hand per frame
 * resolves its options with `resolve`, and its thresholds with `restFor`, once a leg.
 */
export const step = (state: State, dt: number, target: number, spring: Resolved, rest: Rest): PhysicsStepResult<State> => {
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

  const settled = simDt > 0 && atRest(position, velocity, target, rest)
  if (settled) {
    position = target
    velocity = 0
  }
  return { state: { position, velocity, elapsed }, value: position, velocity, done: settled }
}
