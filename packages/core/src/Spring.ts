/**
 * Springs: presets to give `Machine.spring` or a transition, and a spring as a stepper (`resolve`,
 * `init`, `step`) for something you step yourself each frame. A spring is set by its physics,
 * `stiffness`, `damping` and `mass`, or by time, a `duration` or `visualDuration` with a `bounce`. It
 * steps exactly whatever the frame's `dt`, and keeps the velocity it's handed.
 *
 * @example
 * import * as Spring from "@wardic/core/Spring"
 *
 * const spring = Spring.resolve(Spring.stiff)
 * const rest = Spring.restFor(spring, target - x)
 * let state = Spring.init({ from: x })
 * // each frame:
 * const frame = Spring.step(state, dt, target, spring, rest)
 * state = frame.state
 * x = frame.value // and `frame.done` once it rests on `target`
 */
// The stepper is Tier 3 (ADR-0008, ADR-0028 decision 2): `@wardic/dom`'s projection pass steps a
// progress spring per node per frame with it; everything else runs a spring as a machine
// (`Machine.spring`, `Machine.springValues`). It's on the per-frame path (ADR-0025).
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { SpringOptions } from "./Machine.ts"
import { cachedResolver, field, finite, nonNegative, optionalField, positive } from "./internal/options.ts"
import type { PhysicsStepResult } from "./internal/stepper.ts"

// --- Presets: drop into `Machine.spring(…)` or a `transition`.

/** A soft spring that settles without fuss: stiffness 120, damping 14. An everyday choice. */
export const gentle = { stiffness: 120, damping: 14 } as const satisfies SpringOptions
/** A spring that overshoots and wobbles a little: stiffness 180, damping 12. */
export const wobbly = { stiffness: 180, damping: 12 } as const satisfies SpringOptions
/** A quick, firm spring that barely overshoots: stiffness 210, damping 20. An everyday choice. */
export const stiff = { stiffness: 210, damping: 20 } as const satisfies SpringOptions
/** A slow, heavily damped spring with no overshoot: stiffness 280, damping 60. */
export const slow = { stiffness: 280, damping: 60 } as const satisfies SpringOptions
/** Slower still, creeping to its target: stiffness 280, damping 120. */
export const molasses = { stiffness: 280, damping: 120 } as const satisfies SpringOptions
/** A spring that overshoots and bounces: stiffness 400, damping 10. */
export const bouncy = { stiffness: 400, damping: 10 } as const satisfies SpringOptions

/** A spring's state between steps: where it is, how fast it moves, and how long it has run. */
export interface State {
  /** Where it is. */
  readonly position: number
  /** How fast it moves, per second. */
  readonly velocity: number
  /** Seconds it has run, its delay included. */
  readonly elapsed: number
}

/**
 * A spring's options with every default filled in, except its start (`init`'s) and its rest
 * thresholds: those given are kept, and the rest are a leg's, by its distance ({@link restFor}).
 */
export interface Resolved {
  /** Its stiffness: higher is snappier. */
  readonly stiffness: number
  /** Its damping: higher settles sooner, with less overshoot. */
  readonly damping: number
  /** The mass it moves: heavier is slower. */
  readonly mass: number
  /** The rest threshold for the distance to the target, if given: else by distance ({@link restFor}). */
  readonly restDelta: number | undefined
  /** The rest threshold for the speed, per second, if given: else by distance ({@link restFor}). */
  readonly restSpeed: number | undefined
  /** Seconds before it moves. */
  readonly delay: number
  /**
   * How long it runs after its delay, in seconds: a `duration` spring's, which ends then, landing on its
   * target; `Infinity` for every other, which ends at rest.
   */
  // A Time-based spring (#359).
  readonly duration: number
  /** Its step as a matrix, and the last one worked out: read it through `matrixFor`. */
  // Motion's closed form (#370).
  readonly exact: Exact
}

/**
 * A spring's step over a `dt`, exact for any `dt`, from wherever it is: a matrix on its distance from
 * the target `d` and its velocity `v`, `d' = dd·d + dv·v` and `v' = vd·d + vv·v`. For a stepper written
 * out in place; `step` is the one to call otherwise. The matrix for the last `dt` is kept, so every
 * value on one resolved spring shares one `exp`/`sin`/`cos` a frame.
 */
// Motion's closed form (#370, `motion-dom`'s `generators/spring.ts` at 16c6122). Its physics' constants
// are worked out when the spring is resolved. Written through `matrixFor`, by `step`,
// `Machine.springValues` and `Easing.spring`.
export interface Exact {
  /** How it's damped: 0 under (it oscillates), 1 critically, 2 over. */
  readonly kind: 0 | 1 | 2
  /** Its undamped angular frequency, `√(stiffness / mass)`. */
  readonly w0: number
  /** Its decay rate, `damping / (2 · mass)`. */
  readonly decay: number
  /** Its damped angular frequency (under), or its hyperbolic one (over); unused when critical. */
  readonly freq: number
  /** The `dt` the matrix is for: -1 before its first. */
  dt: number
  dd: number
  dv: number
  vd: number
  vv: number
}

/** A leg's rest thresholds: at rest within `delta` of its target, below `speed` per second. */
// #344.
export interface Rest {
  readonly delta: number
  readonly speed: number
}

/**
 * A spring's options (#66, ADR-0025 *Amendment (#66)*; checked by hand since #511, *Amendment
 * (#511)*): the plain bag, checked field by field, each default filled in. `from` and `velocity`
 * are `init`'s, checked here.
 */
const Options = {
  stiffness: optionalField(positive),
  damping: optionalField(nonNegative),
  mass: optionalField(positive),
  restDelta: optionalField(positive),
  restSpeed: optionalField(positive),
  delay: field(nonNegative, 0),
  from: optionalField(finite),
  velocity: optionalField(finite),
  // A time-based spring's (#359, Motion's `DurationSpringOptions`), in seconds.
  duration: optionalField(nonNegative),
  bounce: optionalField(finite),
  visualDuration: optionalField(positive),
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
 * A spring's options with its defaults filled in: stiffness 170, damping 26, mass 1, no delay. A spring
 * set by time is solved to its physics: a `duration` (with a `bounce`, 0.3 by default; a `bounce` alone
 * is a 0.8 s duration) ends at that duration, landing on its target, and a `visualDuration` (with a
 * `bounce`, 0 by default) has done most of its move by then and ends at rest. A `stiffness`, `damping`
 * or `mass` given beside wins over them. A value no spring can take, a stiffness at or below 0 say,
 * throws an `OptionError` naming the field.
 *
 * @example
 * const spring = Spring.resolve({ visualDuration: 0.4, bounce: 0.2 })
 */
// A Time-based spring (#359), as Motion's: `duration` by Motion's `findSpring`, `visualDuration` by
// Motion's closed form. Checked once a bag (#66); rest thresholds left for `restFor`.
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
    exact: exactOf(physics.stiffness, physics.damping, physics.mass),
  }
})

/**
 * Within this of a damping ratio of 1, a spring steps as critically damped (#370): exactly 1 would
 * divide by a damped frequency of 0, and either side of it the two formulas meet to well under it.
 */
const CRITICAL_BAND = 1e-9

/** How a spring of damping ratio `ratio` is damped: {@link Exact}'s `kind`. Statement `if`s. */
const kindOf = (ratio: number): 0 | 1 | 2 => {
  if (Math.abs(ratio - 1) < CRITICAL_BAND) return 1
  if (ratio < 1) return 0
  return 2
}

/** A spring's {@link Exact}, its matrix not yet worked out. */
const exactOf = (stiffness: number, damping: number, mass: number): Exact => {
  const w0 = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * Math.sqrt(stiffness * mass))
  return {
    kind: kindOf(ratio),
    w0,
    decay: damping / (2 * mass),
    freq: w0 * Math.sqrt(Math.abs(1 - ratio * ratio)),
    dt: -1,
    dd: 1,
    dv: 0,
    vd: 0,
    vv: 1,
  }
}

/**
 * Work out `exact`'s matrix for a step of `dt` (#370): Motion's three solutions, from a displacement
 * `d` and a velocity `v`.
 * - Under: `e^(−decay·t)` times a rotation at `freq`.
 * - Critical: `e^(−w0·t)` times a line in `t`.
 * - Over: two decaying exponentials, at `−decay ± freq`. Motion's `cosh`/`sinh` overflow for a large
 *   `freq·t` (it caps it at 300), where these only underflow to 0.
 * Once per spring config per frame: statement `if`s.
 */
const refresh = (m: Exact, dt: number): void => {
  m.dt = dt
  const w2 = m.w0 * m.w0
  if (m.kind === 0) {
    const e = Math.exp(-m.decay * dt)
    // sin(freq·t) / freq: its limit as freq → 0 is t, and a small sine is exact to its last bit.
    const s = Math.sin(m.freq * dt) / m.freq
    const c = Math.cos(m.freq * dt)
    m.dd = e * (c + m.decay * s)
    m.dv = e * s
    m.vd = -e * w2 * s
    m.vv = e * (c - m.decay * s)
    return
  }
  if (m.kind === 1) {
    const e = Math.exp(-m.w0 * dt)
    m.dd = e * (1 + m.w0 * dt)
    m.dv = e * dt
    m.vd = -e * w2 * dt
    m.vv = e * (1 - m.w0 * dt)
    return
  }
  const r1 = m.freq - m.decay
  const r2 = -m.freq - m.decay
  const e1 = Math.exp(r1 * dt)
  const e2 = Math.exp(r2 * dt)
  const span = 2 * m.freq
  m.dd = (r1 * e2 - r2 * e1) / span
  m.dv = (e1 - e2) / span
  m.vd = (w2 * (e2 - e1)) / span
  m.vv = (r1 * e1 - r2 * e2) / span
}

/**
 * A resolved spring's step matrix for `dt`: the one it kept when `dt` is the last one's, else worked out
 * and kept. For a stepper written out in place; `step` is the one to call otherwise. The next `dt`
 * overwrites it, so read it before stepping anything else on the spring.
 */
// #370. Tier 3, for `Machine.springValues` and `Easing.spring`.
export const matrixFor = (spring: Resolved, dt: number): Exact => {
  const m = spring.exact
  if (m.dt !== dt) refresh(m, dt)
  return m
}

/**
 * The distance under which a leg rests by finer thresholds: 0.005 and 0.01 a second, for opacity, a
 * scale or a nudge, where a leg of 5 or more rests within 0.5 and below 2 a second. Motion's
 * `isGranularScale`.
 */
// Motion's default rest thresholds (#344, `motion-dom` `spring.ts`'s `springDefaults` at `16c6122`).
export const GRANULAR = 5
const REST_DELTA = 0.5
const REST_SPEED = 2
const GRANULAR_REST_DELTA = 0.005
const GRANULAR_REST_SPEED = 0.01

/**
 * A leg's rest thresholds, as Motion's are: each one the spring gives, else by how far the leg goes,
 * `distance`, its target less its start. A spring on a progress of its own, 0 to 1, passes a distance
 * of 1000 and that as `scale`, so its thresholds are read in Motion's units. Once a leg: at its start,
 * and at each new target.
 *
 * @example
 * const rest = Spring.restFor(spring, target - from)
 */
// #344: a layout animation's progress spans Motion's 1000.
export const restFor = (spring: Resolved, distance: number, scale = 1): Rest => ({
  delta: restDeltaFor(spring, distance, scale),
  speed: restSpeedFor(spring, distance, scale),
})

/** `restFor`'s `delta` alone, allocating nothing: for a run that keeps its keys' thresholds in arrays. */
export const restDeltaFor = (spring: Resolved, distance: number, scale = 1): number =>
  thresholdOf(spring.restDelta, distance, GRANULAR_REST_DELTA, REST_DELTA) / scale

/** `restFor`'s `speed` alone, allocating nothing. */
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
 * Whether a resolved spring ends at its duration: one set by `duration`, which starts from rest
 * whatever velocity it's handed, as Motion's does, so it lands on time. Step it with `stepTimed`.
 */
// #359.
export const endsOnTime = (spring: Resolved): boolean => spring.duration !== Infinity

/** A spring at `options.from` (0 by default), moving at `options.velocity` (0 by default). */
// Read through `UndefinedOr`, so this module loads nothing of `internal/stepper.ts`, which loads
// `Easing`: `Easing.spring` decodes its bag here (#225).
export const init = (options: SpringOptions): State => ({
  position: UndefinedOr.match(options.from, ZERO),
  velocity: UndefinedOr.match(options.velocity, ZERO),
  elapsed: 0,
})

/** At rest (#344, as Motion's): no faster than `rest.speed`, and no farther from the target than `rest.delta`. */
const atRest = (position: number, velocity: number, target: number, rest: Rest): boolean =>
  Math.abs(velocity) <= rest.speed && Math.abs(position - target) <= rest.delta

/**
 * One frame of a resolved spring toward `target`: its next state, value, velocity, and whether it's
 * done. Only the part of `dt` past its delay moves it, in one exact step; it settles within `rest`,
 * landing exactly on `target`. Resolve its options with `resolve`, and its thresholds with `restFor`,
 * once a leg.
 */
// Motion's closed form (#370).
export const step = (state: State, dt: number, target: number, spring: Resolved, rest: Rest): PhysicsStepResult<State> => {
  const elapsed = state.elapsed + dt
  let position = state.position
  let velocity = state.velocity

  // Only the portion of this frame past the delay.
  const simDt = Math.max(0, Math.min(dt, elapsed - spring.delay))
  if (simDt > 0) {
    const m = matrixFor(spring, simDt)
    const d = position - target
    position = target + m.dd * d + m.dv * velocity
    velocity = m.vd * d + m.vv * velocity
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
 * One frame of a spring that ends at its duration (`endsOnTime`) toward `target`: a `step` that doesn't
 * rest early, landing exactly on `target` once its duration has run after its delay.
 */
// #359. Its own function, around `step`, so `step`, which every other spring takes per frame, stays as
// it was: a read of the duration in it cost a chase ~20% a frame on Bun.
export const stepTimed = (state: State, dt: number, target: number, spring: Resolved): PhysicsStepResult<State> => {
  const result = step(state, dt, target, spring, NEVER_AT_REST)
  const elapsed = result.state.elapsed
  if (elapsed - spring.delay < spring.duration) return result
  return { state: { position: target, velocity: 0, elapsed }, value: target, velocity: 0, done: true }
}
