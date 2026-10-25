/**
 * The `Spring` module: the spring's presets, and its stepper, `init`, `resolve` and `step`.
 * The stepper is Tier 3 (ADR-0008, ADR-0028 decision 2): `@wardic/dom`'s projection pass steps
 * a progress spring per node per frame with it; everything else runs a spring as a machine
 * (`Machine.spring`, `Machine.springValues`). It's on the per-frame path (ADR-0025).
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
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
  /**
   * How long it runs after its delay, in seconds: a `duration` spring's (#359), which ends at it,
   * landing on its target; `Infinity` for one that ends at rest, every other.
   */
  readonly duration: number
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
  stiffness: optionalField(Positive),
  damping: optionalField(NonNegative),
  mass: optionalField(Positive),
  restDelta: optionalField(Positive),
  restSpeed: optionalField(Positive),
  delay: field(NonNegative, 0),
  from: optionalField(Schema.Finite),
  velocity: optionalField(Schema.Finite),
  // A time-based spring's (#359, Motion's `DurationSpringOptions`), in seconds.
  duration: optionalField(NonNegative),
  bounce: optionalField(Schema.Finite),
  visualDuration: optionalField(Positive),
}

/** A spring's physics: its stiffness, damping and mass, and how long it runs after its delay. */
interface Physics {
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
  readonly duration: number
}

/** A spring bag's fields, decoded. */
interface Decoded {
  readonly stiffness: number | undefined
  readonly damping: number | undefined
  readonly mass: number | undefined
  readonly duration: number | undefined
  readonly bounce: number | undefined
  readonly visualDuration: number | undefined
}

// Motion's limits on a time-based spring (#359; `motion-dom`'s `spring.ts`, `springDefaults`, at
// 16c6122): a duration of 0.01 to 10 s, a damping ratio of 0.05 to 1, and its defaults, a duration of
// 0.8 s and a bounce of 0.3 when the other is given.
const MIN_DURATION = 0.01
const MAX_DURATION = 10
const MIN_RATIO = 0.05
const MAX_RATIO = 1
const DEFAULT_DURATION = 0.8
const DEFAULT_BOUNCE = 0.3

/** `n` within `[min, max]`. */
const within = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)

/** A damping ratio from a `bounce`, as Motion's: `1 − bounce`, within 0.05 to 1. */
const ratioOf = (bounce: number): number => within(1 - bounce, MIN_RATIO, MAX_RATIO)

/** Motion's `findSpring` near 0: what its envelope solves for. */
const SAFE_MIN = 0.001

/** Newton's iterations Motion's `approximateRoot` takes: 12, its first guess among them. */
const ROOT_ITERATIONS = Arr.range(1, 11)

/**
 * The stiffness and damping (mass 1) of a spring that settles in `duration` seconds with `bounce`:
 * Motion's `findSpring`, ported (`motion-dom`'s `spring.ts`, at 16c6122), at velocity 0, as Motion
 * solves it, so an inherited velocity can't throw its parameters off. Newton's method from Motion's
 * first guess, 12 iterations; one that fails (NaN) falls back to Motion's 100 / 10.
 */
const solveDuration = (duration: number, bounce: number): { readonly stiffness: number; readonly damping: number } => {
  const ratio = ratioOf(bounce)
  const seconds = within(duration, MIN_DURATION, MAX_DURATION)
  // The envelope's root, and its derivative: an underdamped spring's, or a critically damped one's.
  const { envelope, derivative } = Bool.match(ratio < 1, {
    onTrue: () => {
      const envelope = (freq: number): number => {
        const decay = freq * ratio
        return SAFE_MIN - (decay / (freq * Math.sqrt(1 - ratio * ratio))) * Math.exp(-decay * seconds)
      }
      return {
        envelope,
        derivative: (freq: number): number => {
          const decay = freq * ratio
          const e = ratio * ratio * freq * freq * seconds
          const g = freq * freq * Math.sqrt(1 - ratio * ratio)
          const factor = Bool.match(-envelope(freq) + SAFE_MIN > 0, { onTrue: () => -1, onFalse: () => 1 })
          return (factor * (-e * Math.exp(-decay * seconds))) / g
        },
      }
    },
    onFalse: () => ({
      envelope: (freq: number): number => -SAFE_MIN + Math.exp(-freq * seconds) * (freq * seconds + 1),
      derivative: (freq: number): number => Math.exp(-freq * seconds) * (-freq * (seconds * seconds)),
    }),
  })
  const freq = Arr.reduce(ROOT_ITERATIONS, 5 / seconds, (guess) => guess - envelope(guess) / derivative(guess))
  return Bool.match(Number.isNaN(freq), {
    onTrue: () => ({ stiffness: 100, damping: 10 }),
    onFalse: () => ({ stiffness: freq * freq, damping: ratio * 2 * freq }),
  })
}

/** Whether a bag gives any of a spring's physics, which wins over its time (#359, Motion's `physicsKeys`). */
const givesPhysics = (d: Decoded): boolean => Arr.some([d.stiffness, d.damping, d.mass], Predicate.isNotUndefined)

/** A spring's physics from its bag (#359), by Motion's precedence. Built once, at module load. */
const physicsOf: (d: Decoded) => Physics = Match.type<Decoded>().pipe(
  // Its own physics: core's defaults for what it leaves out; it ends at rest.
  Match.when(givesPhysics, (d): Physics => ({
    stiffness: UndefinedOr.match(d.stiffness, { onUndefined: () => 170, onDefined: (n) => n }),
    damping: UndefinedOr.match(d.damping, { onUndefined: () => 26, onDefined: (n) => n }),
    mass: UndefinedOr.match(d.mass, { onUndefined: () => 1, onDefined: (n) => n }),
    duration: Infinity,
  })),
  // A visual duration (Motion's closed form, `bounce` 0 when it gives none, #359 Q3): most of its
  // move done by then, at rest after, keeping the velocity it's handed.
  Match.when(
    (d) => Predicate.isNotUndefined(d.visualDuration),
    (d): Physics => {
      const root = (2 * Math.PI) / (UndefinedOr.getOrThrow(d.visualDuration) * 1.2)
      const stiffness = root * root
      const bounce = UndefinedOr.match(d.bounce, { onUndefined: () => 0, onDefined: (n) => n })
      return { stiffness, damping: 2 * ratioOf(bounce) * Math.sqrt(stiffness), mass: 1, duration: Infinity }
    },
  ),
  // A duration, or a bounce, solved (Motion's `findSpring`): it ends at its duration.
  Match.when(
    (d) => Bool.or(Predicate.isNotUndefined(d.duration), Predicate.isNotUndefined(d.bounce)),
    (d): Physics => {
      const duration = UndefinedOr.match(d.duration, { onUndefined: () => DEFAULT_DURATION, onDefined: (n) => n })
      const solved = solveDuration(duration, UndefinedOr.match(d.bounce, { onUndefined: () => DEFAULT_BOUNCE, onDefined: (n) => n }))
      return { ...solved, mass: 1, duration: within(duration, MIN_DURATION, MAX_DURATION) }
    },
  ),
  Match.orElse((): Physics => ({ stiffness: 170, damping: 26, mass: 1, duration: Infinity })),
)

/**
 * Fill in a spring's defaults: 170 / 26 / 1, no delay, and its rest thresholds as given (else a
 * leg's, by its distance: {@link restFor}). A spring set by time (#359, a **Time-based spring**, as
 * Motion's) is solved to its physics instead: a `duration` (with a `bounce`, default 0.3, or a
 * `bounce` alone, a duration of 0.8 s) by Motion's `findSpring`, ending at that duration; a
 * `visualDuration` (with a `bounce`, default 0) by Motion's closed form, ending at rest. A
 * `stiffness`, `damping` or `mass` given beside wins over them. Decoded once a bag (#66): a value no
 * spring can take (a stiffness or mass at or below 0, a negative damping or duration, NaN,
 * Infinity) throws its `SchemaError`, naming the field.
 */
export const resolve: (options: SpringOptions) => Resolved = cachedResolver(Options, (decoded): Resolved => {
  const physics = physicsOf(decoded)
  // One literal, not a spread of `physics`: a spread's object read slower on the per-frame path
  // (JavaScriptCore, a chase ~20% a frame, #359).
  return {
    stiffness: physics.stiffness,
    damping: physics.damping,
    mass: physics.mass,
    restDelta: decoded.restDelta,
    restSpeed: decoded.restSpeed,
    delay: decoded.delay,
    duration: physics.duration,
  }
})

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
 * Whether a spring ends at its duration (#359): a `duration` spring, which starts from rest whatever
 * velocity it's handed, as Motion's does, so it lands on time. It steps by {@link stepTimed}.
 */
export const endsOnTime = (spring: Resolved): boolean => spring.duration !== Infinity

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

/** Rest thresholds no spring meets: a spring that ends at its duration never ends at rest (#359). */
const NEVER_AT_REST: Rest = { delta: -1, speed: -1 }

/**
 * One frame of a spring that ends at its duration (#359, {@link endsOnTime}) toward `target`: a
 * {@link step} that never rests, landing exactly on `target` once its duration has run after its
 * delay. Its own function, around `step`, so `step`, which every other spring takes per frame, stays
 * as it was: a read of the duration in it cost a chase ~20% a frame on Bun (#359).
 */
export const stepTimed = (state: State, dt: number, target: number, spring: Resolved): PhysicsStepResult<State> => {
  const result = step(state, dt, target, spring, NEVER_AT_REST)
  const elapsed = result.state.elapsed
  if (elapsed - spring.delay < spring.duration) return result
  return { state: { position: target, velocity: 0, elapsed }, value: target, velocity: 0, done: true }
}
