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
import * as Schema from "effect/Schema"
import * as Easing from "../Easing.ts"
import type { DecayOptions, TweenOptions } from "../Machine.ts"
import * as Scalar from "../Scalar.ts"
import { cachedResolver, field, Fn, NonNegative, optionalField, Positive } from "./options.ts"

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
  /** Its `ease`, resolved to the curve (#360). */
  readonly ease: Easing.Easing
}

/** An `ease` (#360, ADR-0052): one of Motion's names, a bézier's four numbers, or a function. */
export const EaseDefinition = Schema.Union([
  Schema.Literals(Easing.NAMES_LIST),
  Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
  Fn<Easing.Easing>("an easing function"),
])

/**
 * Wardic's old name for `ease` (#360): a bag still giving it is rejected, naming `ease`. A transition
 * hoisted into a constant gets past TypeScript's check for a key its type doesn't have, and would
 * otherwise lose its easing without a word.
 */
export const NoEasing = Schema.declare((_given: unknown): _given is never => false, { expected: "`ease`: Wardic's `easing` is `ease` now, as Motion's (#360)" })

/** A tween's fields as a Schema (#66): `animate`'s bag adds its repeat modifiers to them. */
export const TweenFields = {
  delay: field(NonNegative, 0),
  duration: field(NonNegative, DEFAULT_DURATION),
  ease: field(EaseDefinition, Easing.linear as Easing.Definition),
  easing: optionalField(NoEasing),
}

/** A decoded tween's fields, resolved: its duration clamped for division, as given beside it, its `ease` to its curve. */
export const resolvedTweenOf = (decoded: { readonly delay: number; readonly duration: number; readonly ease: Easing.Definition }): ResolvedTween => ({
  delay: decoded.delay,
  duration: durationOf(decoded.duration),
  seconds: decoded.duration,
  ease: Easing.resolve(decoded.ease),
})

/**
 * Fill in a tween's defaults: 0.3 s, no delay, linear. Decoded once a bag (#66): a negative or
 * non-finite duration or delay, an `ease` that's none of Motion's names, four numbers or a function,
 * or a leftover `easing` (#360), throws its `SchemaError`. Public as `Machine.resolveTween`, Tier 3,
 * for dom's layout tween.
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
  const eased = tween.ease(t)
  return { state: { elapsed }, value: Scalar.lerp(from, to, eased), done: elapsed >= tween.delay + tween.duration }
}

// --- A run of repeats, and keyframes (#226) ----------------------------------

/**
 * `animate`'s run, resolved: one tween played `repeats + 1` times, `gap` seconds apart, every other
 * pass turned by its `repeatType`. Its tween's `delay` is 0: `Machine.delay` holds it, outside.
 */
export interface ResolvedRun {
  readonly tween: ResolvedTween
  /** The passes after the first: a whole number, or `Infinity`. */
  readonly repeats: number
  /** The hold after every pass but the last, in seconds (`repeatDelay`). */
  readonly gap: number
  /** A pass and its gap, in seconds: `duration + gap`. */
  readonly cycle: number
  /** The whole run, in seconds: `cycle · (repeats + 1) − gap`, `Infinity` for an endless one. */
  readonly total: number
  /** Every other pass plays backwards in time (`repeatType: "reverse"`). */
  readonly reverses: boolean
  /** Every other pass plays from `to` to `from`, eased forwards (`repeatType: "mirror"`). */
  readonly mirrors: boolean
}

/** A sampled Frame's fields: the value, and whether the run has ended. */
export interface Sample {
  readonly value: number
  readonly done: boolean
}

/**
 * Where a run from `from` to `to` is `t` seconds in, by Motion's `JSAnimation` iteration math
 * (motion-dom 13.3.0): every pass and every gap is a stretch of one time, so a pass starts the
 * moment the one before it ends, wherever that falls in a tick (#226). A gap holds where its pass
 * ended. Per frame (ADR-0025): arithmetic and statement `if`s.
 */
export const runAt = (t: number, from: number, to: number, run: ResolvedRun): Sample => {
  const duration = run.tween.duration
  const cycle = run.cycle
  const total = run.total
  const time = Math.min(t, total)
  let pass = Math.floor(time / cycle)
  let within = Math.max(0, time - pass * cycle)
  // A pass's end is its own, not the start of the next.
  if (within === 0 && pass > 0) {
    pass--
    within = cycle
  }
  const s = Math.min(within / duration, 1)
  const done = t >= total
  if (pass % 2 === 1 && run.reverses) return { value: Scalar.lerp(from, to, run.tween.ease(1 - s)), done }
  if (pass % 2 === 1 && run.mirrors) return { value: Scalar.lerp(to, from, run.tween.ease(s)), done }
  return { value: Scalar.lerp(from, to, run.tween.ease(s)), done }
}

/**
 * Where keyframes through `stops` (two or more) are `t` seconds into `total`, each Segment `segment`
 * seconds long (at least `Number.EPSILON`) and eased whole, on its own easing from `eases` (one per
 * Segment, wrapping round when there are fewer, as Motion's `getEasingForSegment`; #360): Motion's
 * keyframes, evenly spaced. One time across every Segment, so the next starts the moment one ends
 * (#226). Per frame (ADR-0025).
 */
export const keyframesAt = (t: number, stops: ReadonlyArray<number>, segment: number, total: number, eases: ReadonlyArray<Easing.Easing>): Sample => {
  const last = stops.length - 1
  const time = Math.min(t, total)
  const i = Math.min(Math.floor(time / segment), last - 1)
  const s = Math.min(Math.max((time - i * segment) / segment, 0), 1)
  const ease = eases[i % eases.length]
  return { value: Scalar.lerp(stops[i], stops[i + 1], ease(s)), done: t >= total }
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
  readonly restSpeed: number
  readonly delay: number
}

/**
 * Fill in a decay's defaults: friction 3, rest below 0.1, no delay. Decoded once a bag (#66): a
 * friction or rest speed at or below 0, or a non-finite value, throws its `SchemaError`.
 */
export const resolveDecay: (options: DecayOptions) => ResolvedDecay = cachedResolver(
  {
    friction: field(Positive, 3),
    restSpeed: field(Positive, 0.1),
    delay: field(NonNegative, 0),
  },
  ({ friction, restSpeed, delay }): ResolvedDecay => ({ friction, restSpeed, delay }),
)

export const initDecay = (initial: number, velocity: number): DecayState => ({
  position: initial,
  velocity,
  elapsed: 0,
})

/**
 * One frame of a resolved decay, in closed form (#23): over `dt` the velocity falls by
 * `e^(−friction·dt)` and the position moves by its integral, `velocity · (1 − e^(−friction·dt)) / friction`.
 * So a decay comes to rest at `velocity / friction` from its start whatever the frame rate, and a
 * stall up to `MAX_DT` lands it where its frames would have (an Euler step fell 2.5% short at 60 Hz,
 * and a third short through a 500 ms stall).
 */
export const stepDecay = (state: DecayState, dt: number, decay: ResolvedDecay): PhysicsStepResult<DecayState> => {
  const elapsed = state.elapsed + dt

  let position = state.position
  let velocity = state.velocity
  const simDt = Math.max(0, Math.min(dt, elapsed - decay.delay))
  if (simDt > 0) {
    const kept = Math.exp(-decay.friction * simDt)
    position += (velocity * (1 - kept)) / decay.friction
    velocity *= kept
  }

  const done = simDt > 0 && Math.abs(velocity) < decay.restSpeed
  return { state: { position, velocity, elapsed }, value: position, velocity, done }
}
