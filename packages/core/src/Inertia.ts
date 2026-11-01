/**
 * The `Inertia` module: Motion's `inertia` generator (motion-dom 13.3.0, `animation/generators/inertia.ts`)
 * as a stepper, `resolve`, `init` and `step` (ADR-0016, *Amendment (#140)*). A glide from `initial`
 * toward its resting point, `initial + power × velocity` (passed through `modifyTarget`), easing out as
 * `target − amplitude · e^(−t / timeConstant)`, done within `restDelta` of it. Where the glide would
 * cross `min` or `max`, or starts past one, it hands over to a spring toward the nearest edge on the
 * bounce (`bounceStiffness`, `bounceDamping`), from the glide's speed there, its exact derivative.
 *
 * In seconds, as every option bag in core: Motion's `timeConstant` is in milliseconds. Resolved once
 * per run (its glide depends on where it starts); each step is pure, a plain call. The stepper is
 * Tier 3 (ADR-0008, ADR-0028 decision 2), as `Spring`'s: `@wardic/dom`'s projection pass steps a
 * node's Release offset with it per frame; everything else runs one as a machine (`Machine.inertia`,
 * `Machine.inertiaVec`). It's on the per-frame path (ADR-0025).
 */
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { cachedResolver, field, finite, fn, nonNegative, notNaN, positive } from "./internal/options.ts"
import type { PhysicsStepResult } from "./internal/stepper.ts"
import type { InertiaOptions } from "./Machine.ts"

/**
 * The bounce's spring (Motion's `spring` generator, motion-dom 13.3.0, `generators/spring.ts`, mass 1):
 * its undamped angular frequency, damping ratio, and rest thresholds. Analytic, as Motion's: a wall as
 * stiff as Motion's with no `dragElastic` (1e6 / 1e7) is exact, where a stepped integration isn't stable.
 */
interface BounceSpring {
  readonly omega: number
  readonly ratio: number
  readonly restDelta: number
  readonly restSpeed: number
}

/** An inertia's options with every default filled in, and its glide worked out from where it starts. */
export interface Resolved {
  /** Where the glide rests: `initial + power × velocity`, or where `modifyTarget` moved that. */
  readonly target: number
  /** How far the glide goes: `target − initial`. */
  readonly amplitude: number
  /** The glide's time constant, in seconds. */
  readonly timeConstant: number
  readonly restDelta: number
  /** The edges, `−∞` and `+∞` where none is given. */
  readonly min: number
  readonly max: number
  readonly bounce: BounceSpring
}

/**
 * A bounce under way: Motion's spring from where and how fast the glide crossed an edge, toward the
 * edge, its constants worked out once at the crossing. `velocity` is Motion's `s.velocity`, minus the
 * speed it started with.
 */
interface Bounce {
  readonly startedAt: number
  readonly edge: number
  readonly delta: number
  readonly velocity: number
  readonly kind: "under" | "critical" | "over"
  /** The decay rate, `ratio × omega`. */
  readonly decay: number
  /** The damped angular frequency (under and over). */
  readonly freq: number
  /** Each regime's constants: under, `A`, `sinC`, `cosC`; critical, `C`; over, `P'`, `sinhC`, `coshC`. */
  readonly a: number
  readonly b: number
  readonly c: number
}

/** An inertia's state: its time, and once it reached an edge, the bounce toward it. */
export interface State {
  readonly elapsed: number
  readonly bounce: Bounce | undefined
}

/** Motion's generator defaults (`inertia`): a drag's release passes its own (ADR-0016, *Amendment (#140)*). */
const DEFAULT_POWER = 0.8
const DEFAULT_TIME_CONSTANT = 0.325
const DEFAULT_BOUNCE_STIFFNESS = 500
const DEFAULT_BOUNCE_DAMPING = 10
const DEFAULT_REST_DELTA = 0.5
/** Motion's spring's rest speed for a move larger than a few units, which a bounce is. */
const DEFAULT_REST_SPEED = 2
/** Motion caps the overdamped spring's `sinh` and `cosh` argument here, so they never overflow. */
const MAX_HYPERBOLIC = 300

/** No `modifyTarget`: the resting point as it is. */
const asIs = (ideal: number): number => ideal

/** An inertia's options with every default filled in. */
interface Decoded {
  readonly power: number
  readonly timeConstant: number
  readonly bounceStiffness: number
  readonly bounceDamping: number
  readonly restDelta: number
  readonly restSpeed: number
  readonly modifyTarget: (ideal: number) => number
  readonly min: number
  readonly max: number
}

/**
 * An inertia's options (#66, ADR-0025 *Amendment (#66)*; checked by hand since #511, *Amendment
 * (#511)*): the plain bag, checked field by field. It rejects a value no inertia can take (a time
 * constant, bounce stiffness or rest threshold at or below 0, a negative bounce damping, a power that
 * isn't finite, an edge that's NaN, or `min` above `max`; an infinite edge is no edge), and Motion's
 * defaults are filled in.
 */
const decode: (options: InertiaOptions) => Decoded = cachedResolver(
  {
    power: field(finite, DEFAULT_POWER),
    timeConstant: field(positive, DEFAULT_TIME_CONSTANT),
    bounceStiffness: field(positive, DEFAULT_BOUNCE_STIFFNESS),
    bounceDamping: field(nonNegative, DEFAULT_BOUNCE_DAMPING),
    restDelta: field(positive, DEFAULT_REST_DELTA),
    restSpeed: field(positive, DEFAULT_REST_SPEED),
    modifyTarget: field(fn<(ideal: number) => number>("a modifyTarget function"), asIs),
    min: field(notNaN, Number.NEGATIVE_INFINITY),
    max: field(notNaN, Number.POSITIVE_INFINITY),
  },
  (decoded): Decoded => decoded,
  ({ min, max }) => Bool.match(min <= max, { onTrue: () => true, onFalse: () => `Expected min (${min}) at or below max (${max})` }),
)

/**
 * Fill in an inertia's defaults and work out its glide from `initial` at `velocity`. Once per run;
 * the options are checked once a bag (#66), and a value no inertia can take throws its `OptionError`.
 */
export const resolve = (initial: number, velocity: number, options: InertiaOptions): Resolved => {
  const o = decode(options)
  const target = o.modifyTarget(initial + o.power * velocity)
  return {
    target,
    amplitude: target - initial,
    timeConstant: o.timeConstant,
    restDelta: o.restDelta,
    min: o.min,
    max: o.max,
    bounce: {
      omega: Math.sqrt(o.bounceStiffness),
      ratio: o.bounceDamping / (2 * Math.sqrt(o.bounceStiffness)),
      restDelta: o.restDelta,
      restSpeed: o.restSpeed,
    },
  }
}

/**
 * Where an inertia from `initial` at `velocity` comes to rest (#468): its glide's resting point, held
 * to its edges (one the glide crosses is where the bounce rests), or the edge nearest a start past one.
 * What a skipped one lands on at once. A value no inertia can take throws its `OptionError`, as
 * {@link resolve}'s.
 */
export const restOf = (initial: number, velocity: number, options: InertiaOptions): number => {
  const inertia = resolve(initial, velocity, options)
  if (outOfBounds(initial, inertia)) return nearestEdge(initial, inertia)
  return Math.min(Math.max(inertia.target, inertia.min), inertia.max)
}

/** The glide's distance from its resting point at `t` seconds: `−amplitude · e^(−t / timeConstant)`. Per frame. */
const glideDelta = (t: number, inertia: Resolved): number => -inertia.amplitude * Math.exp(-t / inertia.timeConstant)

/** The edge nearest `position`, past which it sits. Per frame. */
const nearestEdge = (position: number, inertia: Resolved): number => {
  if (Math.abs(inertia.min - position) < Math.abs(inertia.max - position)) return inertia.min
  return inertia.max
}

/** Whether `position` is past an edge. Per frame. */
const outOfBounds = (position: number, inertia: Resolved): boolean => {
  if (position < inertia.min) return true
  return position > inertia.max
}

/** Motion's spring constants for a bounce from `from` at `speed` toward `edge`, starting at `startedAt` seconds. At a crossing. */
const bounceFrom = (startedAt: number, from: number, speed: number, edge: number, spring: BounceSpring): Bounce => {
  const delta = edge - from
  const velocity = -speed
  const decay = spring.ratio * spring.omega
  const base = { startedAt, edge, delta, velocity, decay }
  if (spring.ratio < 1) {
    const freq = spring.omega * Math.sqrt(1 - spring.ratio * spring.ratio)
    const a = (velocity + decay * delta) / freq
    return { ...base, kind: "under", freq, a, b: decay * a + delta * freq, c: decay * delta - a * freq }
  }
  if (spring.ratio === 1) return { ...base, kind: "critical", freq: 0, a: velocity + spring.omega * delta, b: 0, c: 0 }
  const freq = spring.omega * Math.sqrt(spring.ratio * spring.ratio - 1)
  const p = (velocity + decay * delta) / freq
  return { ...base, kind: "over", freq, a: velocity + decay * delta, b: decay * p - delta * freq, c: decay * delta - p * freq }
}

/** A bounce's position `t` seconds after it started (Motion's `resolveSpring`). Per frame. */
const bounceAt = (bounce: Bounce, t: number, omega: number): number => {
  const env = Math.exp(-bounce.decay * t)
  if (bounce.kind === "under") return bounce.edge - env * (bounce.a * Math.sin(bounce.freq * t) + bounce.delta * Math.cos(bounce.freq * t))
  if (bounce.kind === "critical") return bounce.edge - Math.exp(-omega * t) * (bounce.delta + bounce.a * t)
  const f = Math.min(bounce.freq * t, MAX_HYPERBOLIC)
  return bounce.edge - (env * (bounce.a * Math.sinh(f) + bounce.freq * bounce.delta * Math.cosh(f))) / bounce.freq
}

/** A bounce's speed `t` seconds after it started (Motion's `resolveVelocity`), per second. Per frame. */
const bounceSpeedAt = (bounce: Bounce, t: number, omega: number): number => {
  const env = Math.exp(-bounce.decay * t)
  if (bounce.kind === "under") return env * (bounce.b * Math.sin(bounce.freq * t) + bounce.c * Math.cos(bounce.freq * t))
  if (bounce.kind === "critical") return Math.exp(-omega * t) * (omega * bounce.a * t - bounce.velocity)
  const f = Math.min(bounce.freq * t, MAX_HYPERBOLIC)
  return env * (bounce.b * Math.sinh(f) + bounce.c * Math.cosh(f))
}

/**
 * An inertia at its start: gliding, or, when `initial` is already past an edge, springing back to it
 * from the glide's speed at 0 (Motion's `checkCatchBoundary(0)`).
 */
export const init = (initial: number, inertia: Resolved): State =>
  Bool.match(outOfBounds(initial, inertia), {
    onFalse: (): State => ({ elapsed: 0, bounce: undefined }),
    onTrue: (): State => ({
      elapsed: 0,
      bounce: bounceFrom(0, initial, -glideDelta(0, inertia) / inertia.timeConstant, nearestEdge(initial, inertia), inertia.bounce),
    }),
  })

/**
 * One frame of a resolved inertia. While it glides, its value is the glide's at its time; the frame
 * that crosses an edge shows the glide's value past it, and the bounce takes over from there (Motion's
 * `spring.next(t − timeReachedBoundary)`), resting on the edge once within `restDelta` and `restSpeed`.
 * Per frame: statement `if`s, one state object.
 */
export const step = (state: State, dt: number, inertia: Resolved): PhysicsStepResult<State> => {
  const elapsed = state.elapsed + dt
  const bounce = state.bounce
  if (Predicate.isNotUndefined(bounce)) {
    const t = elapsed - bounce.startedAt
    const position = bounceAt(bounce, t, inertia.bounce.omega)
    const speed = bounceSpeedAt(bounce, t, inertia.bounce.omega)
    const next = { elapsed, bounce }
    // At rest only when both hold, so a step that isn't a number (a NaN option) is never at rest.
    const slow = Math.abs(speed) <= inertia.bounce.restSpeed
    if (slow && Math.abs(bounce.edge - position) <= inertia.bounce.restDelta) return { state: next, value: bounce.edge, velocity: 0, done: true }
    return { state: next, value: position, velocity: speed, done: false }
  }
  const delta = glideDelta(elapsed, inertia)
  const velocity = -delta / inertia.timeConstant
  const glided = Math.abs(delta) <= inertia.restDelta
  let position = inertia.target + delta
  if (glided) position = inertia.target
  if (outOfBounds(position, inertia)) {
    return {
      state: { elapsed, bounce: bounceFrom(elapsed, position, velocity, nearestEdge(position, inertia), inertia.bounce) },
      value: position,
      velocity,
      done: false,
    }
  }
  if (glided) return { state: { elapsed, bounce: undefined }, value: position, velocity: 0, done: true }
  return { state: { elapsed, bounce: undefined }, value: position, velocity, done: false }
}
