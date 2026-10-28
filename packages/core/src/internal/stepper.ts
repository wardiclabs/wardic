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
import * as Arr from "effect/Array"
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
 * Where a run is in its pass (#429): how far into it, in seconds, whether its time runs backwards,
 * and whether it reads its stops from last to first. Written in place, once a frame, by
 * {@link passAt}.
 */
export interface Pass {
  /** Seconds into the pass, at most its duration: a gap after it holds at its end. */
  within: number
  /** Its time runs backwards: a `"reverse"` pass. */
  reversed: boolean
  /** It reads its stops from last to first: a `"mirror"` pass, or every pass with `reverse`. */
  flipped: boolean
}

/**
 * Where a run is `t` seconds in, by Motion's `JSAnimation` iteration math (motion-dom 13.3.0): every
 * pass and every gap is a stretch of one time, so a pass starts the moment the one before it ends,
 * wherever that falls in a tick (#226). A gap holds where its pass ended. Every other pass is
 * turned by its `repeatType`, and `flip` (`reverse`) reads every pass's stops from last to first,
 * Motion's mirrored generator (#429). Written into `pass`; whether the run has ended. Per frame
 * (ADR-0025): arithmetic and statement `if`s.
 */
export const passAt = (t: number, run: ResolvedRun, flip: boolean, pass: Pass): boolean => {
  const cycle = run.cycle
  const total = run.total
  const time = Math.min(t, total)
  let n = Math.floor(time / cycle)
  let within = Math.max(0, time - n * cycle)
  // A pass's end is its own, not the start of the next.
  if (within === 0 && n > 0) {
    n--
    within = cycle
  }
  const odd = n % 2 === 1
  pass.within = Math.min(within, run.tween.duration)
  pass.reversed = odd && run.reverses
  pass.flipped = flip !== (odd && run.mirrors)
  return t >= total
}

/** {@link runAt}'s pass, written in place: it's read right after, and never across a call. */
const RUN_PASS: Pass = { within: 0, reversed: false, flipped: false }

/**
 * Where a run from `from` to `to` is `t` seconds in ({@link passAt}): a reversed pass eases back
 * along its curve, a mirrored one runs from `to` to `from` on the same easing. Per frame (ADR-0025).
 */
export const runAt = (t: number, from: number, to: number, run: ResolvedRun): Sample => {
  const done = passAt(t, run, false, RUN_PASS)
  let s = RUN_PASS.within / run.tween.duration
  if (RUN_PASS.reversed) s = 1 - s
  const eased = run.tween.ease(s)
  if (RUN_PASS.flipped) return { value: Scalar.lerp(to, from, eased), done }
  return { value: Scalar.lerp(from, to, eased), done }
}

/** Seconds into a pass of `duration`, in the direction it runs: from its end, in a reversed pass. */
export const timeIn = (pass: Pass, duration: number): number => {
  if (pass.reversed) return duration - pass.within
  return pass.within
}

/**
 * Each stop's time in a pass of `duration` seconds (#429): its place in `times` when there's one per
 * stop, as Motion's `keyframes` takes them (`convertOffsetToTimes`), else evenly spaced (Motion's
 * `defaultOffset`), each a whole number of Segments in. `count` is two or more.
 */
export const stopTimesOf = (count: number, times: ReadonlyArray<number> | undefined, duration: number): ReadonlyArray<number> => {
  if (Predicate.isNotUndefined(times) && times.length === count) return Arr.map(times, (time) => time * duration)
  return Arr.makeBy(count, (i) => (i * duration) / (count - 1))
}

/**
 * The Segment a pass `time` seconds in is in, by its stops' times: the first whose end it hasn't
 * reached, else the last (Motion's `interpolate`). Per frame (ADR-0025).
 */
export const segmentAt = (time: number, stopTimes: ReadonlyArray<number>): number => {
  const last = stopTimes.length - 2
  let i = 0
  while (i < last && time >= stopTimes[i + 1]) i++
  return i
}

/**
 * How far through Segment `i` a pass `time` seconds in is, 0 to 1; all the way through one with no
 * length (Motion's `progress`). Per frame (ADR-0025).
 */
export const segmentProgress = (time: number, stopTimes: ReadonlyArray<number>, i: number): number => {
  const start = stopTimes[i]
  const length = stopTimes[i + 1] - start
  if (length === 0) return 1
  return Scalar.clamp((time - start) / length, 0, 1)
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
