/**
 * Machines: an animation as a value. A machine is what an animation does each frame, apart from what
 * drives it: `start()` it, and the step it returns takes each frame's `dt`, in seconds, and gives that
 * frame, `{ value, done }`. Each run has its own state, so one machine can run any number of times.
 *
 * - **Build** one with a constructor: `tween`, `spring`, `chase`, `decay`, `inertia`, `animate`,
 *   `keyframes`; for a bag of values, `springValues`, `inertiaValues`, `animateValues`, `springBlend`
 *   and `keyframesValues`. Or with `make`, for a motion of your own.
 * - **Compose** with `map`, `concat`, `concatAll`, `forever`, `delay`, `holdAfter`, `startAt`, `clampDt`
 *   and `withSpan`. A machine is `Pipeable`: `m.pipe(Machine.delay(0.1))`. Never spread one, which
 *   loses what makes it a machine.
 * - **Run** one on the Frame loop with `run`, which steps every running machine in one pass a frame,
 *   or as a `Stream` over the Clock's ticks with `toStream`. Both give the same frames.
 *
 * @example
 * import * as Machine from "@wardic/core/Machine"
 *
 * const fadeIn = Machine.tween(0, 1, { duration: 0.3, ease: "easeOut" }).pipe(Machine.delay(0.1))
 * // On the Frame loop, each Frame drawn:
 * yield* Machine.run(fadeIn, (frame) => {
 *   draw(frame.value)
 * })
 * // Or stepped by hand:
 * const step = fadeIn.start()
 * step(1 / 60) // { value: 0, done: false }: still in its delay
 */
// ADR-0028: a Primitive's motion as a value, so a Primitive is its machine (ADR-0027, ADR-0028 decision
// 4). Each driver opens the machine's one span per run (`span`), with its `<name>: subscribe` or
// `<name>: start` debug log; `toStream` is one fiber per subscriber (Tier 2, ADR-0001). Combinators run
// when a machine is built, never per step: a combinator's `start()` starts its inner machine, and its
// step makes plain calls only, allocating only the Frame it returns, and only when it changes it
// (ADR-0028, decision 7). Defaults add no layer: `delay(0)`, `holdAfter(0)` and a one-interval `concatAll`
// return their input. `springBlend`, `animateValues` and `keyframesValues` return an `Effect` needing the
// `InterpolatorRegistry`. Tier 2 (ADR-0008): for binding and Environment authors.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { identity, type LazyArg } from "effect/Function"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type { Covariant } from "effect/Types"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Clock from "./Clock.ts"
import * as Easing from "./Easing.ts"
import type * as Frame from "./Frame.ts"
import * as FrameLoop from "./FrameLoop.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import { sourceOf } from "./internal/driven.ts"
import { array, boolean, cachedResolver, checked, field, finite, literals, nonEmptyArray, nonNegative, number, optionalField, refine, union } from "./internal/options.ts"
import {
  EaseDefinition,
  initDecay,
  initTween,
  type Pass,
  passAt,
  resolveDecay,
  type ResolvedRun,
  type ResolvedTween,
  resolvedTweenOf,
  resolveTween,
  runAt,
  intervalAt,
  intervalProgress,
  stepDecay,
  stopTimesOf,
  timeIn,
  stepTween,
  TweenFields,
} from "./internal/stepper.ts"
import * as Inertia from "./Inertia.ts"
import type * as Point from "./Point.ts"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"
import type * as Supersede from "./Supersede.ts"
import type * as Values from "./Values.ts"
import { dual } from "./internal/dual.ts"
import { tracedStream } from "./internal/tracing.ts"

// --- The data type -----------------------------------------------------------

const TypeId = "~@wardic/core/Machine"

/**
 * An animation as a value: what it does each frame, apart from what drives it. Build one with a
 * constructor or `make`, never as a literal: a literal, or a spread of a machine, isn't one.
 */
// ADR-0027.
export interface Machine<out F extends Frame.Frame<unknown>> extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: { readonly _F: Covariant<F> }
  /**
   * One run: a step from each tick's `dt` (seconds, as the Clock reports it) to that tick's
   * Frame. Each run holds its own state, so a machine can be started any number of times.
   */
  readonly start: () => (dt: number) => F
  /**
   * Whether a run ends at its first settled Frame. `chase` doesn't: its Frame reports rest, but
   * the run goes on until it's removed. Nor does `forever`, whose Frames never settle.
   */
  readonly settles: boolean
  /** The span each run gets, on either driver: its name and attributes, for traces and logs. */
  // ADR-0028, decision 6.
  readonly span: Span
}

/** A machine's span: a name and its attributes, opened by a driver once per run. */
export interface Span {
  readonly name: string
  readonly attributes: Readonly<Record<string, unknown>>
}

/** `withSpan`'s options, Effect's `{ attributes }`. */
export interface SpanOptions {
  readonly attributes?: Readonly<Record<string, unknown>>
}

const Proto = {
  [TypeId]: { _F: identity },
  ...Inspectable.BaseProto,
  toJSON(this: Machine<Frame.Frame<unknown>>) {
    return { _id: "Machine", span: this.span, settles: this.settles }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * A machine from its fields: a run's `start`, whether it `settles`, and its `span`. For a motion of your
 * own; the constructors cover the common ones.
 *
 * @example
 * // A blink: 1 and 0 by turns, twice a second, for ever.
 * const blink = Machine.make({
 *   settles: false,
 *   span: { name: "app.blink", attributes: {} },
 *   start: () => {
 *     let time = 0
 *     return (dt) => {
 *       time += dt
 *       return { value: Math.floor(time * 2) % 2, done: false }
 *     }
 *   },
 * })
 */
// Decision 6.
export const make = <F extends Frame.Frame<unknown>>(fields: {
  readonly start: () => (dt: number) => F
  readonly settles: boolean
  readonly span: Span
}): Machine<F> => Object.assign(Object.create(Proto), fields)

/** Whether `u` is a machine (built by `make` or a constructor). */
export const isMachine = (u: unknown): u is Machine<Frame.Frame<unknown>> => Predicate.hasProperty(u, TypeId)

/**
 * The most time a machine moves in one step: 0.5 s. A frame that took longer, such as the first after
 * the app was hidden, moves it 0.5 s, and the animation plays the rest out from there, where Motion's
 * jumps to its end. Every constructor holds each step to it.
 */
// Every constructor clamps each step's `dt` here once (#78), in its leaves' steps and in `delay`'s hold,
// so both drivers clamp and no stepper needs to defend itself; dom's projection pass clamps its own.
// Inline, not a `clampDt` layer: a layer is one more call per element per frame, which V8 doesn't
// inline (ADR-0028, *Implementation in #94*). Why 500 ms (#23, ADR-0017 *Amendment (#23)*): a stall up
// to it reaches each consumer whole, so a tween, a spring, decay, inertia or a layout animation lands
// where wall time puts it, as Motion's time-based animations do; a longer one advances it 500 ms. It
// once bounded the spring's cost too; since #370 a spring steps in closed form. A sequence's seams
// drop the rest of a tick, a stall's included (#226).
export const MAX_DT = 0.5

// --- The option bags ---------------------------------------------------------
//
// Durations and delays are in seconds, matching the public `transition: { duration: 0.3 }`
// surface and the `dt` the Clock emits. Each bag is checked by hand (#66, ADR-0025 *Amendment
// (#66)*; without Schema since #511, *Amendment (#511)*): once a bag, when an animation is built,
// filling in its defaults; a value no animation can take throws an `OptionError`, naming the field.
// It's here, beside the bags: every resolver and builder that takes one throws it (`Spring.resolve`,
// `Inertia.resolve`, `resolveTween`, `spring`, `tween`, `animate`, `keyframes`, `decay`, `inertia`,
// …, and `Easing.spring`).
export { OptionError } from "./internal/options.ts"

/**
 * A tween's options: its `duration`, `ease` and `delay`. A bag is read once and kept by its identity:
 * one changed after it's handed over isn't seen, so pass a new one.
 */
export interface TweenOptions {
  /** Seconds it takes. Default 0.3. */
  // A missing duration leaves the other options as they are (#107).
  readonly duration?: number
  /**
   * How it eases, as Motion's `ease`: one of Motion's names (`"easeOut"`), a cubic Bézier's four numbers
   * (`[0.25, 0.1, 0.35, 1]`), or a function. Default linear.
   */
  // #360, ADR-0052.
  readonly ease?: Easing.Definition
  /**
   * Delay before the animation starts, in seconds. With `animate`'s `repeat` / `repeatType`, or across
   * `keyframes`' stops, it holds once, before the first Interval: `Machine.delay`.
   */
  // #77.
  readonly delay?: number
}

/**
 * `keyframes`' and `keyframesValues`' options: a tween's, its `ease` one easing or one per stretch
 * between stops (wrapping round when there are fewer, as Motion's), each stop's place in `times`, and
 * the repeats, over the whole run of stops.
 */
// #360, #429.
export interface KeyframesOptions extends Omit<TweenOptions, "ease">, Modifiers {
  readonly ease?: Easing.Definition | ReadonlyArray<Easing.Definition>
  /**
   * Each stop's place in the run, from 0 (its start) to 1 (its `duration`), in order, as Motion's
   * `times`: `[0, 0.2, 1]` reaches the second of three stops a fifth of the way in. Used when there's one
   * per stop; otherwise the stops are evenly spaced.
   */
  readonly times?: ReadonlyArray<number>
}

/**
 * A tween's options resolved, and its resolver (#66): Tier 3 (ADR-0008, ADR-0028 decision 2), as
 * `Spring.resolve` is, for `@wardic/dom`'s projection pass, which runs a layout tween on it.
 */
export { type ResolvedTween, resolveTween } from "./internal/stepper.ts"

/**
 * A missing bag: one object, so its decode is cached (#66) and a builder called without options
 * decodes once, not once a call.
 */
const NO_OPTIONS = {}

/**
 * A spring's options: its physics (`stiffness`, `damping`, `mass`) or its time (`duration` or
 * `visualDuration`, with `bounce`), where it starts and how fast, its rest thresholds, and a delay.
 * A bag is read once and kept by its identity: one changed after it's handed over isn't seen, so pass
 * a new one.
 */
export interface SpringOptions {
  /** Where it starts. Default 0. */
  readonly from?: number
  /** How stiff it is: higher is snappier. Default 170. */
  readonly stiffness?: number
  /** How damped it is: higher settles sooner, with less overshoot. Default 26. */
  readonly damping?: number
  /** The mass it moves: heavier is slower. Default 1. */
  readonly mass?: number
  /** The velocity it starts with, per second. Default 0. */
  readonly velocity?: number
  /**
   * At rest within this of its target. By default, as Motion's: 0.5 for a move of 5 or more, 0.005 for
   * one shorter (an opacity, a scale, a nudge), by each value's distance each time its target changes.
   */
  // #344.
  readonly restDelta?: number
  /** At rest below this speed, per second. By default, as Motion's: 2 for a move of 5 or more, 0.01 for one shorter. */
  // #344.
  readonly restSpeed?: number
  /** Delay before the animation starts, in seconds. */
  readonly delay?: number
  /**
   * A spring set by time: it lands on its target at `duration` seconds, from rest, its stiffness and
   * damping solved from it and `bounce`. Within 0.01 to 10 s. A `stiffness`, `damping` or `mass` given
   * beside wins over it, and so does a `visualDuration`.
   */
  // A Time-based spring (#359), as Motion's.
  readonly duration?: number
  /**
   * How much a spring set by time bounces: 0 none, toward 1 a lot. Default 0.3 with a `duration`, 0 with
   * a `visualDuration`; alone, it's a 0.8 s `duration` spring.
   */
  // #359: its damping ratio is `1 − bounce`, within 0.05 to 1.
  readonly bounce?: number
  /**
   * A spring set by time that has done most of its move by `visualDuration` seconds, and ends at rest
   * after, keeping the velocity it's handed. With `bounce`, or alone.
   */
  // #359, Motion's closed form.
  readonly visualDuration?: number
}

/**
 * A decay's options: how quickly it slows, when it rests, and a delay. A bag is read once and kept by
 * its identity: one changed after it's handed over isn't seen, so pass a new one.
 */
export interface DecayOptions {
  /** How quickly it slows: higher stops sooner. Default 3. */
  readonly friction?: number
  /** At rest below this speed, per second. Default 0.1. */
  readonly restSpeed?: number
  /** Delay before the animation starts, in seconds. */
  readonly delay?: number
}

/**
 * An inertia's options: how far it glides and how it eases out, its edges and the spring back from
 * them, and where it rests. Times in seconds, where Motion's `timeConstant` is in milliseconds. A bag
 * is read once and kept by its identity: one changed after it's handed over isn't seen, so pass a new
 * one.
 */
// ADR-0016, *Amendment (#140)*, Motion's `inertia`.
export interface InertiaOptions {
  /** How far the glide carries, as a multiple of the velocity: it rests at `initial + power × velocity`. Default 0.8. */
  readonly power?: number
  /** The glide's time constant, in seconds: it eases out as `e^(−t / timeConstant)`. Default 0.325. */
  readonly timeConstant?: number
  /** The bounce spring's stiffness at an edge. Default 500. */
  readonly bounceStiffness?: number
  /** The bounce spring's damping. Default 10. */
  readonly bounceDamping?: number
  /** The glide is done within this of where it rests, and the bounce within this of its edge. Default 0.5. */
  readonly restDelta?: number
  /** The bounce rests below this speed, per second. Default 2. */
  readonly restSpeed?: number
  /** Moves where the glide rests, called once with where it would: snapping a flick to a grid, say. */
  readonly modifyTarget?: (ideal: number) => number
  /** The edges: past one, the glide springs back to it. None by default. */
  readonly min?: number
  readonly max?: number
}

/** An axis's edges for {@link inertiaVec}: either may be left out. */
export interface InertiaEdges {
  readonly min?: number
  readonly max?: number
}

/** Options for {@link inertiaVec}: {@link InertiaOptions} for both axes, with each axis's edges. */
export interface InertiaVecOptions extends Omit<InertiaOptions, "min" | "max"> {
  readonly x?: InertiaEdges
  readonly y?: InertiaEdges
}

/** How a tween repeats: `repeat`, `repeatType` and `repeatDelay`, and `reverse`. */
export interface Modifiers {
  /**
   * How many more times it plays after the first: a whole number, or `Infinity` for ever. Default 0.
   * Each starts the moment the one before ends, or `repeatDelay` after; `delay` holds once, before the
   * first.
   */
  // Wherever that falls in a tick (#226); `delay` once (#77).
  readonly repeat?: number
  /**
   * Seconds between plays, as Motion's `repeatDelay`. Default 0. Each play but the last holds where it
   * ended for this long; with an infinite `repeat`, every play does.
   */
  // #91.
  readonly repeatDelay?: number
  /**
   * How every other repeat runs, as Motion's `repeatType`. Default `"loop"`.
   * - `"loop"`: each run starts at `from` again.
   * - `"reverse"`: every other run plays backwards in time, from `to` to `from` on the easing's
   *   curve reversed: an `easeOut` run comes back easing in.
   * - `"mirror"`: every other run plays from `to` to `from` on the same easing: an `easeOut` run
   *   comes back easing out.
   */
  readonly repeatType?: "loop" | "reverse" | "mirror"
  /** Plays it from `to` back to `from`; keyframes, through their stops from last to first. Default `false`. */
  // #429.
  readonly reverse?: boolean
}

/** Options accepted by `animate` and `animateValues`. */
export interface AnimateOptions extends TweenOptions, Modifiers {}

// --- The combinators ---------------------------------------------------------

/** `frame`, re-stamped `done: false`: a seam's one allocation. */
const unsettled = <F extends Frame.Frame<unknown>>(frame: F): F => ({ ...frame, done: false })

/**
 * `self` with each frame mapped by `f`. Keeps `self`'s span.
 *
 * @example
 * const turn = Machine.spring(1).pipe(Machine.map((frame) => ({ ...frame, value: frame.value * 360 })))
 */
// `f` runs per frame (ADR-0025).
export const map: {
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(f: (frame: F) => G): (self: Machine<F>) => Machine<G>
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(self: Machine<F>, f: (frame: F) => G): Machine<G>
} = dual(
  2,
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(self: Machine<F>, f: (frame: F) => G): Machine<G> =>
    make({
      settles: self.settles,
      span: self.span,
      start: () => {
        const step = self.start()
        return (dt) => f(step(dt))
      },
    }),
)

/**
 * Machines played one after another, as one run: each starts on the frame after the one before it
 * settles, so a long sequence runs up to a frame a seam behind wall time. For tweens back to back,
 * exactly on time, use `keyframes`. A machine that never settles, a `chase` or a `forever`, is the last
 * one reached. One machine is returned as it is. Keeps the first's span.
 *
 * @example
 * const there = Machine.tween(0, 100, { duration: 0.3 })
 * const back = Machine.tween(100, 0, { duration: 0.3 })
 * const trip = Machine.concatAll([there, back])
 */
// `Stream.concat`'s seam over N Intervals, flat, with one step through them (ADR-0027, decision 4): a
// Interval's settled Frame is re-stamped `done: false` unless it's the last, and the next starts on the
// next tick with no leftover time; `keyframes` and `animate` are one leaf over one time (#226). Effect
// v3's name: v4 has no `Stream.concatAll`.
export const concatAll = <F extends Frame.Frame<unknown>>(intervals: Arr.NonEmptyReadonlyArray<Machine<F>>): Machine<F> => {
  const reached = Option.match(
    Arr.findFirstIndex(intervals, (interval) => !interval.settles),
    {
      onNone: () => intervals,
      onSome: (endless): Arr.NonEmptyReadonlyArray<Machine<F>> => [
        Arr.headNonEmpty(intervals),
        ...Arr.take(Arr.tailNonEmpty(intervals), endless),
      ],
    },
  )
  const first = Arr.headNonEmpty(reached)
  return Bool.match(reached.length === 1, {
    onTrue: () => first,
    onFalse: () =>
      make({
        settles: Arr.lastNonEmpty(reached).settles,
        span: first.span,
        start: () => {
          const last = reached.length - 1
          let index = 0
          let step = first.start()
          // Per frame (ADR-0025): a statement `if`, and one Frame re-stamped at each seam.
          return (dt) => {
            const frame = step(dt)
            if (index === last || !frame.done) return frame
            index++
            step = reached[index].start()
            return unsettled(frame)
          }
        },
      }),
  })
}

/**
 * `that` after `self`, on the frame after `self` settles: `concatAll` of the two. A `self` that never
 * settles never reaches `that`. Keeps `self`'s span.
 *
 * @example
 * const trip = there.pipe(Machine.concat(back))
 */
// `Stream.concat`'s seam (#226).
export const concat: {
  <G extends Frame.Frame<unknown>>(that: Machine<G>): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F | G>
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(self: Machine<F>, that: Machine<G>): Machine<F | G>
} = dual(
  2,
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(self: Machine<F>, that: Machine<G>): Machine<F | G> =>
    concatAll<F | G>([self, that]),
)

/**
 * `self` started again each time it settles, for ever, so a run never settles. Each restart is up to a
 * frame behind wall time; `animate`'s `repeat: Infinity` is exact. A `self` that never settles is
 * returned as it is. Keeps `self`'s span.
 */
// `Stream.forever`'s; each settled Frame re-stamped `done: false`, the rest of its tick dropped (#226).
export const forever = <F extends Frame.Frame<unknown>>(self: Machine<F>): Machine<F> =>
  Bool.match(self.settles, {
    onFalse: () => self,
    onTrue: () =>
      make({
        settles: false,
        span: self.span,
        start: () => {
          let step = self.start()
          // Per frame (ADR-0025): a statement `if`, and one Frame re-stamped at each restart.
          return (dt) => {
            const frame = step(dt)
            if (!frame.done) return frame
            step = self.start()
            return unsettled(frame)
          }
        },
      }),
  })

/**
 * A wait before `self` starts: for `seconds`, each frame is the frame `self` starts at; then `self`
 * steps on with the time left over. A negative `seconds` starts it that far in. `delay(0)` is `self`.
 * Keeps `self`'s span.
 *
 * @example
 * const late = Machine.spring(1).pipe(Machine.delay(0.2))
 */
// `Effect.delay`'s word. The held time counts each tick's `dt` at most `MAX_DT`, as a step does; the same
// Frame object every held tick. Not the steppers' own `delay`, which a leaf keeps (dom's projection pass
// steps springs by hand with it): a Frame after this hold can differ in its last bit, since the hold is
// subtracted at a different point (ADR-0028, decision 9).
export const delay: {
  (seconds: number): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, seconds: number): Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, seconds: number): Machine<F> =>
    // NaN or an infinity would hold it for ever, never settling (#618); a negative delay starts it that far in.
    Bool.match(checked(finite, seconds, "seconds") === 0, {
      onTrue: () => self,
      onFalse: () =>
        make({
          settles: self.settles,
          span: self.span,
          start: () => {
            const step = self.start()
            const first = step(0)
            const held = Bool.match(first.done, { onTrue: () => unsettled(first), onFalse: () => first })
            let elapsed = 0
            let holding = true
            // Per frame (ADR-0025): statement `if`s, `Math.min`; the held Frame built above.
            return (dt) => {
              if (!holding) return step(dt)
              elapsed += Math.min(dt, MAX_DT)
              if (elapsed < seconds) return held
              holding = false
              return step(elapsed - seconds)
            }
          },
        }),
    }),
)

/**
 * A wait after `self` settles: its settled frame for `seconds` more, then it settles. A `self` that
 * never settles, or a hold of 0 or less, is returned as it is. Keeps `self`'s span.
 *
 * @example
 * const pause = Machine.tween(0, 1, { duration: 0.3 }).pipe(Machine.holdAfter(1))
 */
// CONTEXT.md's Hold; #91's name: Effect has no hold after. Re-stamped `done: false` once; starts on the
// tick after `self` settles, so the rest of that tick is dropped (`animate`'s `repeatDelay` is
// time-exact, #226).
export const holdAfter: {
  (seconds: number): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, seconds: number): Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, seconds: number): Machine<F> =>
    Bool.match(seconds <= 0 || !self.settles, {
      onTrue: () => self,
      onFalse: () =>
        make({
          settles: true,
          span: self.span,
          start: () => {
            const step = self.start()
            // The settled Frame and its re-stamp: set when `self` settles, before the hold reads them.
            let settled: F | undefined
            let held: F | undefined
            let holding = false
            let elapsed = 0
            // Per frame (ADR-0025): statement `if`s, `Math.min`; one Frame re-stamped, once.
            return (dt) => {
              if (holding) {
                elapsed += Math.min(dt, MAX_DT)
                if (elapsed < seconds) return UndefinedOr.getOrThrow(held)
                return UndefinedOr.getOrThrow(settled)
              }
              const frame = step(dt)
              if (!frame.done) return frame
              holding = true
              settled = frame
              held = unsettled(frame)
              return held
            }
          },
        }),
    }),
)

/** The step `startAt` catches up in: a 60 Hz frame. */
// ADR-0044: a run caught up to `k / 60` seconds has taken the steps a 60 Hz driver would have by then,
// and drawn the Frame the DOM's Appear sampler samples there (`@wardic/dom/Appear`).
export const CATCH_UP_DT = 1 / 60

/**
 * `self` started partway through: its first frame steps it from its start to `at()` seconds in, a 60 Hz
 * frame at a time, and every frame after steps as usual. `at` is read once a run, at its first frame. A
 * negative `at()` is a start still to come: it holds at its start that long. For an animation that
 * began before the app's code loaded, as a server-rendered one does, taken over where it has got to. Keeps `self`'s span, and whether
 * it settles.
 *
 * @example
 * const resumed = Machine.tween(0, 1, { duration: 1 }).pipe(Machine.startAt(() => elapsedSeconds))
 */
// ADR-0044's Handoff: the catch-up steps `0`, then `CATCH_UP_DT` at a time, the Frame at `k / 60` the
// one the Appear sampler drew; it stops at a settled Frame. A Handoff reads `at` in the frame that draws
// the run's first Frame. A negative `at()`: a child its parent let go a frame early starts when the
// Appear animation would have started it.
export const startAt: {
  (at: LazyArg<number>): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, at: LazyArg<number>): Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, at: LazyArg<number>): Machine<F> =>
    make({
      settles: self.settles,
      span: self.span,
      start: () => {
        const step = self.start()
        // 0: the first tick to come; 1: holding a start still to come; 2: stepping.
        let phase = 0
        let hold = 0
        let held: F | undefined
        // Per frame (ADR-0025): statement `if`s; the catch-up runs once, on the first tick.
        return (dt) => {
          if (phase === 2) return step(dt)
          if (phase === 0) {
            const seconds = at()
            if (seconds >= 0) {
              phase = 2
              return catchUp(step, seconds)
            }
            phase = 1
            hold = -seconds
            const first = step(0)
            held = first
            if (first.done) held = unsettled(first)
            return held
          }
          hold -= Math.min(dt, MAX_DT)
          if (hold > 0) return UndefinedOr.getOrThrow(held)
          phase = 2
          return step(-hold)
        }
      },
    }),
)

/** How long `durationOf` lets a run go to settle: 20 s, as Motion's `maxGeneratorDuration`. */
// #433.
export const MAX_DURATION = 20

/**
 * How long a run of `self` takes to settle, in seconds: `Infinity` for one that doesn't, a `chase` or a
 * `forever`, or hasn't by `MAX_DURATION`. It runs the machine to find out, up to 1,200 steps a call.
 *
 * @example
 * Machine.durationOf(Machine.spring(1, Spring.gentle)) // ≈ 1.1
 */
// #433, Motion's `duration`: stepped from its start, `CATCH_UP_DT` a step, as `startAt` catches up.
export const durationOf = <F extends Frame.Frame<unknown>>(self: Machine<F>): number => {
  if (Bool.not(self.settles)) return Number.POSITIVE_INFINITY
  // A driven machine measures as the one it drives, so measuring leaves its playhead where it is (#618).
  const step = sourceOf(self).start()
  let frame = step(0)
  const most = Math.ceil(MAX_DURATION / CATCH_UP_DT)
  // A counted loop, a settled Frame ending it, as `catchUp`'s.
  for (let i = 0; i < most; i++) {
    if (frame.done) return i * CATCH_UP_DT
    frame = step(CATCH_UP_DT)
  }
  if (frame.done) return MAX_DURATION
  return Number.POSITIVE_INFINITY
}

/** `step` from its start to `seconds` in: `0`, then `CATCH_UP_DT` a step, the last what's left; a settled Frame ends it. */
const catchUp = <F extends Frame.Frame<unknown>>(step: (dt: number) => F, seconds: number): F => {
  let frame = step(0)
  // The whole frames in `seconds`, a hair's rounding allowed (`k / 60` back to `k`).
  const whole = Math.max(0, Math.floor(seconds / CATCH_UP_DT + 1e-9))
  // In a tick (ADR-0025): a counted loop, a settled Frame ending it.
  for (let i = 0; i < whole; i++) {
    if (frame.done) return frame
    frame = step(CATCH_UP_DT)
  }
  const rest = seconds - whole * CATCH_UP_DT
  if (frame.done || rest <= 1e-9) return frame
  return step(rest)
}

/** `self` with each `dt` held to `max` before its step: for a machine built with `make`. The constructors hold theirs to `MAX_DT`. */
// #78: the constructors clamp inline. Keeps `self`'s span.
export const clampDt: {
  (max: number): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, max: number): Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, max: number): Machine<F> =>
    make({
      settles: self.settles,
      span: self.span,
      start: () => {
        const step = self.start()
        // Per frame (ADR-0025): `Math.min`.
        return (dt) => step(Math.min(dt, max))
      },
    }),
)

/**
 * `self` under the span `name`, with `options.attributes`, in place of its own: its runs' traces and
 * logs carry that name.
 *
 * @example
 * const bounce = Machine.spring(1).pipe(Machine.withSpan("app.bounce", { attributes: { card: id } }))
 */
// A machine's span is data until a driver opens it (decision 6). `dual` as `Stream.withSpan` is, told
// apart by its first argument.
export const withSpan: {
  (name: string, options?: SpanOptions): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, name: string, options?: SpanOptions): Machine<F>
} = dual(
  isMachine,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, name: string, { attributes = {} }: SpanOptions = {}): Machine<F> =>
    make({ start: self.start, settles: self.settles, span: { name, attributes } }),
)

// --- The drivers -------------------------------------------------------------

/** A settled Frame: a settling machine's run ends at its first. */
const isSettled = (frame: Frame.Frame<unknown>): boolean => frame.done

/** A Frame with a record `velocity` beside its record `value`: `springValues`' (`Frame.MultiPhysics`). */
const isMultiPhysics = (frame: Frame.Frame<unknown>): frame is Frame.MultiPhysics =>
  Predicate.isObject((frame as Frame.MultiPhysics).velocity)

/**
 * A Frame its Stream consumer owns: a record `value`, and a record `velocity` beside it, copied,
 * since a step may rewrite them in place (`springValues`, ADR-0030 decision 11). Any other Frame
 * passes as it is: a leaf's is fresh each tick, and a held one is never rewritten. On the
 * per-frame path (ADR-0025): statement `if`s and plain calls.
 */
const owned = <F extends Frame.Frame<unknown>>(frame: F): F => {
  if (!Predicate.isObject(frame.value)) return frame
  if (isMultiPhysics(frame)) return { ...frame, value: { ...frame.value }, velocity: { ...frame.velocity } }
  return { ...frame, value: { ...frame.value } }
}

/**
 * `self` as a `Stream` over the Clock's ticks: a frame a tick, through its settled frame when it settles.
 * Each subscriber gets a run of its own, and each frame is its to keep. For one value in an Effect
 * program; `run` steps every running machine in one pass a frame, which is cheaper for many.
 *
 * @example
 * yield* Machine.toStream(fadeIn).pipe(Stream.runForEach((frame) => Effect.sync(() => draw(frame.value))))
 */
// Each subscription's run under the machine's one span, with a `<name>: subscribe` debug log annotated
// with its attributes; per-frame work is unlogged. A record Frame is copied (`owned`) before it's
// emitted, so a consumer that collects Frames never sees one rewritten (ADR-0030, decision 11). A
// Stream, not a Channel: measured 2026-11-02, Stream's own layers were ~5% of a pull of the Clock's
// ticks, and elements never use `toStream`, so a Channel would gain nothing measurable (#618, M5).
export const toStream = <F extends Frame.Frame<unknown>>(self: Machine<F>): Stream.Stream<F, never, Clock.Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      yield* Effect.logDebug(`${self.span.name}: subscribe`)
      const step = self.start()
      // Per frame (ADR-0025): the step, then the copy, plain calls in one closure built here.
      const frames = clock.ticks.pipe(Stream.map((dt: number) => owned(step(dt))))
      return Bool.match(self.settles, {
        onTrue: () => frames.pipe(Stream.takeUntil(isSettled)),
        onFalse: () => frames,
      })
    }).pipe(Effect.annotateLogs(self.span.attributes)),
  ).pipe((frames) => tracedStream(frames, self.span.name, { attributes: self.span.attributes }))

/**
 * Runs `self` on the Frame loop, from its next tick, handing each frame to `sink`. It succeeds with the
 * settled frame; one that never settles runs until it's interrupted, and interrupting removes it at
 * once. A frame handed to `sink` is the run's until the next tick: copy one to keep it. Given
 * `{ supersede }`, it ends with the other runs given the same token, succeeding with
 * `Supersede.Superseded`.
 *
 * @example
 * const landed = yield* Machine.run(Machine.spring(200), (frame) => {
 *   moveTo(frame.value)
 * })
 */
// A plain call, typed `(frame) => undefined`, so a sink that returns an Effect doesn't compile
// (ADR-0027, decision 8). Dies if the step or the sink throws, or with the loop's own failure. One span
// per run, with a `<name>: start` debug log. The token (#200, ADR-0027 *Amendment (#200)*): it leaves the
// loop at once, as an interrupted run does, about a sixth of the cost. `springValues` rewrites one Frame
// per run (ADR-0030, decision 11). A machine built with a service: `Effect.flatMap(Machine.run(sink))`.
export const run: {
  <F extends Frame.Frame<unknown>>(sink: FrameLoop.Sink<F>): (self: Machine<F>) => Effect.Effect<F, never, FrameLoop.FrameLoop>
  <F extends Frame.Frame<unknown>>(
    sink: FrameLoop.Sink<F>,
    options: RunOptions,
  ): (self: Machine<F>) => Effect.Effect<F | Supersede.Superseded, never, FrameLoop.FrameLoop>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, sink: FrameLoop.Sink<F>): Effect.Effect<F, never, FrameLoop.FrameLoop>
  <F extends Frame.Frame<unknown>>(
    self: Machine<F>,
    sink: FrameLoop.Sink<F>,
    options: RunOptions,
  ): Effect.Effect<F | Supersede.Superseded, never, FrameLoop.FrameLoop>
} = dual(
  isMachine,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, sink: FrameLoop.Sink<F>, options?: RunOptions): Effect.Effect<F | Supersede.Superseded, never, FrameLoop.FrameLoop> =>
    // The loop reads a missing `options` as none: one call, nothing allocated per run.
    FrameLoop.FrameLoop.use((loop) => loop.run(self, sink, options as RunOptions)),
)

/** `run`'s options: the token the run joins, so `Supersede.end` ends it with the others. */
// #200.
export interface RunOptions {
  readonly supersede: Supersede.Supersede
}

// --- The leaves --------------------------------------------------------------

/** A tween's step from 0 elapsed: `tween`'s, and each of `animate`'s and `keyframes`' Intervals. */
const tweenLeaf = (from: number, to: number, tween: ResolvedTween, span: Span): Machine<Frame.Frame<number>> =>
  make({
    settles: true,
    span,
    start: () => {
      let state = initTween()
      // Per frame (ADR-0025): the tween resolved when the machine is built, `dt` clamped (#78).
      return (dt) => {
        const result = stepTween(state, Math.min(dt, MAX_DT), from, to, tween)
        state = result.state
        return { value: result.value, done: result.done }
      }
    },
  })

/** A tween's span. */
const tweenSpan = (from: number, to: number, duration: number): Span => ({
  name: "wardic.tween",
  attributes: { from, to, duration },
})

/**
 * A tween from `from` to `to` over `options.duration`, eased by its `ease`, after its `delay`.
 *
 * @example
 * const slide = Machine.tween(0, 240, { duration: 0.4, ease: "easeInOut" })
 */
export const tween = (from: number, to: number, options: TweenOptions): Machine<Frame.Frame<number>> => {
  const resolved = resolveTween(options)
  return tweenLeaf(from, to, resolved, tweenSpan(from, to, resolved.seconds))
}

/** A run's new target (#344): its thresholds again, by its distance from `position`, if that changed its granularity. */
const retarget = (rest: RunRest, target: number, position: number): void => {
  rest.goal = target
  const distance = target - position
  const granular = Math.abs(distance) < GRANULAR
  if (granular === rest.granular) return
  rest.granular = granular
  rest.delta = Spring.restDeltaFor(rest.spring, distance)
  rest.speed = Spring.restSpeedFor(rest.spring, distance)
}

/** A spring run's thresholds, the target they're for, and its spring (#344): one object, written in place. */
interface RunRest {
  delta: number
  speed: number
  goal: number
  granular: boolean
  readonly spring: Spring.Resolved
}

/** {@link Spring.GRANULAR}, read once, declared before the runs that read it (a later `const` costs JavaScriptCore a check at each read). */
const GRANULAR = Spring.GRANULAR

/**
 * The spring stepper toward `getTarget()`, read afresh on every step, so a moving target is
 * followed without stale snapshots: `chase`'s run, and `spring`'s toward a static target.
 */
const springRun =
  (getTarget: () => number, spring: Spring.Resolved, options: SpringOptions) => (): ((dt: number) => Frame.Physics) => {
    // A spring that ends at its duration starts from rest, whatever velocity it's handed (#359, as
    // Motion's), so it lands on time.
    let state = Spring.init(options)
    if (Spring.endsOnTime(spring)) state = { ...state, velocity: 0 }
    // Its rest thresholds by its distance (#344), as Motion's retarget works them out at each new
    // target: only whether the distance is granular can change them, and with both given they
    // never do. A new target is noticed before the step and handled after it (`retarget`): any
    // arithmetic on a number before the step made JavaScriptCore (Bun's, Safari's) compile the run
    // ~2.5× slower, where a check after it costs nothing (#344's bench, `.tmp/344/standalone2.ts`).
    // So a new leg's thresholds take over from its second frame, its distance read where its first
    // step left it: on its first frame the last leg's still apply. A sub-pixel retarget of a pixel
    // spring at rest can rest at once, within 0.5, where Motion's would glide that far.
    const first = getTarget()
    const rest: RunRest = {
      delta: Spring.restDeltaFor(spring, first - state.position),
      speed: Spring.restSpeedFor(spring, first - state.position),
      goal: first,
      granular: Math.abs(first - state.position) < GRANULAR,
      spring,
    }
    // A spring that ends at its duration (#359) starts it again, from rest, where a new target finds
    // it, as Motion's `FollowAnimation` does (a delay still running runs on), stepping by
    // `Spring.stepTimed`; its rest thresholds play no part. Its own run, so the others' stay as they were.
    if (Spring.endsOnTime(spring)) {
      let goal = first
      return (dt) => {
        const target = getTarget()
        if (target !== goal) {
          goal = target
          state = { position: state.position, velocity: 0, elapsed: Math.min(state.elapsed, spring.delay) }
        }
        const result = Spring.stepTimed(state, Math.min(dt, MAX_DT), target, spring)
        state = result.state
        return { value: result.value, velocity: result.velocity, done: result.done }
      }
    }
    // Per frame (ADR-0025): the spring resolved when the machine is built, `dt` clamped (#78).
    if (Bool.and(Predicate.isNotUndefined(spring.restDelta), Predicate.isNotUndefined(spring.restSpeed))) {
      return (dt) => {
        const result = Spring.step(state, Math.min(dt, MAX_DT), getTarget(), spring, rest)
        state = result.state
        return { value: result.value, velocity: result.velocity, done: result.done }
      }
    }
    return (dt) => {
      const target = getTarget()
      const moved = target !== rest.goal
      const result = Spring.step(state, Math.min(dt, MAX_DT), target, spring, rest)
      state = result.state
      if (moved) retarget(rest, target, result.value)
      return { value: result.value, velocity: result.velocity, done: result.done }
    }
  }

/**
 * A spring toward `target`, from `options.from` (0 by default), settling at rest. A moving target is
 * `chase`'s.
 *
 * @example
 * const pop = Machine.spring(1, { from: 0.8, stiffness: 400, damping: 15 })
 */
export const spring = (target: number, options: SpringOptions = NO_OPTIONS): Machine<Frame.Physics> => {
  const resolved = Spring.resolve(options)
  return make({
    settles: true,
    span: { name: "wardic.spring", attributes: { target, stiffness: resolved.stiffness, damping: resolved.damping } },
    start: springRun(() => target, resolved, options),
  })
}

/**
 * A spring that follows a moving target: `getTarget()` is read every step, so it tracks a cursor, a
 * scroll position or a target that changes often. Its frames report rest, but it never settles: a run
 * ends only when it's removed.
 *
 * @example
 * const follow = Machine.chase(() => pointer.x, Spring.gentle)
 */
export const chase = (getTarget: () => number, options: SpringOptions = NO_OPTIONS): Machine<Frame.Physics> => {
  const resolved = Spring.resolve(options)
  return make({
    settles: false,
    span: { name: "wardic.chase", attributes: { stiffness: resolved.stiffness, damping: resolved.damping } },
    start: springRun(getTarget, resolved, options),
  })
}

/**
 * A decay: from `initial` at `velocity`, slowing by friction, to rest `velocity / friction` away,
 * whatever the frame rate.
 *
 * @example
 * const coast = Machine.decay(x, 900, { friction: 4 })
 */
// Stepped in closed form (#23).
export const decay = (initial: number, velocity: number, options: DecayOptions = NO_OPTIONS): Machine<Frame.Physics> => {
  const resolved = resolveDecay(options)
  return make({
    settles: true,
    span: { name: "wardic.decay", attributes: { initial, velocity, friction: resolved.friction } },
    start: () => {
      let state = initDecay(initial, velocity)
      // Per frame (ADR-0025): the decay resolved when the machine is built, `dt` clamped (#78).
      return (dt) => {
        const result = stepDecay(state, Math.min(dt, MAX_DT), resolved)
        state = result.state
        return { value: result.value, velocity: result.velocity, done: result.done }
      }
    },
  })
}

/** A decay on two axes together: a point each frame, settling once both rest. */
export const decayVec = (initial: Point.Point, velocity: Point.Point, options: DecayOptions): Machine<Frame.Frame<Point.Point>> => {
  const resolved = resolveDecay(options)
  return make({
    settles: true,
    span: { name: "wardic.decayVec", attributes: { friction: resolved.friction } },
    start: () => {
      let x = initDecay(initial.x, velocity.x)
      let y = initDecay(initial.y, velocity.y)
      // Per frame (ADR-0025): the decay resolved when the machine is built, `dt` clamped once
      // (#78), no allocation beyond the Frame.
      return (dt) => {
        const clamped = Math.min(dt, MAX_DT)
        const rx = stepDecay(x, clamped, resolved)
        const ry = stepDecay(y, clamped, resolved)
        x = rx.state
        y = ry.state
        return { value: { x: rx.value, y: ry.value }, done: rx.done && ry.done }
      }
    },
  })
}

/**
 * An inertia: a glide from `initial` at `velocity` toward `initial + power × velocity`, or where
 * `modifyTarget` moves that, easing out over `timeConstant`; where it would pass `min` or `max`, or
 * starts past one, it springs back to that edge. What a drag's release runs.
 *
 * @example
 * // A flick that rests on a 100 px grid, within 0 and 800.
 * const snap = Machine.inertia(x, velocity, { modifyTarget: (end) => Math.round(end / 100) * 100, min: 0, max: 800 })
 */
// ADR-0016, *Amendment (#140)*, Motion's `inertia`: a Fling, and a snap back to the origin (both edges 0).
export const inertia = (initial: number, velocity: number, options: InertiaOptions = NO_OPTIONS): Machine<Frame.Physics> =>
  make({
    settles: true,
    span: { name: "wardic.inertia", attributes: { initial, velocity } },
    start: () => {
      const resolved = Inertia.resolve(initial, velocity, options)
      let state = Inertia.init(initial, resolved)
      // Per frame (ADR-0025): the glide resolved at the run's start, `dt` clamped (#78).
      return (dt) => {
        const result = Inertia.step(state, Math.min(dt, MAX_DT), resolved)
        state = result.state
        return { value: result.value, velocity: result.velocity, done: result.done }
      }
    },
  })

/** {@link inertiaValues}' options: {@link InertiaOptions}, each key's velocity when it has none of its own, and a delay. */
export interface InertiaValuesOptions extends InertiaOptions {
  /** A key's velocity when `velocity` gives it none, per second. Default 0. */
  readonly velocity?: number
  /** Seconds each key holds where it starts before it glides. Default 0. */
  readonly delay?: number
}

/** {@link inertiaValues}' run: each key's velocity, else the options', per second. */
// #618 (F3): beside the options, not in them. A bag is cached by its identity, so a run's own data
// in it would miss the cache every leg.
export interface InertiaValuesStart {
  readonly velocity?: Readonly<Record<string, number>>
}

/** {@link springValues}' run: each key's start and velocity, else the options'. */
// #618 (F3), as {@link InertiaValuesStart}.
export interface SpringValuesStart {
  readonly from?: Readonly<Record<string, number>>
  readonly velocity?: Readonly<Record<string, number>>
}

/** A start's values when it gives none. */
const NO_START_VALUES: Readonly<Record<string, number>> = {}

/** No start of a run's own: every key from the options. */
const NO_START: SpringValuesStart = {}

/**
 * Inertia on a bag of numbers, as a transition's `type: "inertia"`: one glide per key from `from`, at
 * its velocity in `start.velocity` (else `options.velocity`, else 0), on the shared `options`, after
 * `options.delay`, settling once every key rests. It takes no target: each key rests where its glide
 * does, through `modifyTarget`, held within `min` and `max`. With no velocity, a key rests where it
 * starts.
 *
 * Each frame carries a per-key `velocity` beside `value`, and is rewritten every tick: copy a frame to
 * keep it.
 */
// #435, Motion's `type: "inertia"` transition; rewritten in place (ADR-0030, decision 11).
export const inertiaValues = (
  from: Readonly<Record<string, number>>,
  options: InertiaValuesOptions = NO_OPTIONS,
  start: InertiaValuesStart = NO_START,
): Machine<Frame.MultiPhysics> => {
  const { velocity = NO_START_VALUES } = start
  const keys = Rec.keys(from)
  const delay = UndefinedOr.match(options.delay, { onUndefined: () => 0, onDefined: identity })
  const fallback = UndefinedOr.match(options.velocity, { onUndefined: () => 0, onDefined: identity })
  return make({
    settles: true,
    span: { name: "wardic.inertiaValues", attributes: { keys: keys.length } },
    start: () => {
      const count = keys.length
      const starts = Arr.map(keys, (key) => UndefinedOr.getOrThrow(from[key]))
      const resolved = Arr.map(keys, (key, i) =>
        Inertia.resolve(starts[i] as number, UndefinedOr.match(velocity[key], { onUndefined: () => fallback, onDefined: identity }), options))
      const states = Arr.map(keys, (_, i) => Inertia.init(starts[i] as number, resolved[i] as Inertia.Resolved))
      const frame = { value: { ...from }, velocity: Rec.map(from, () => 0), done: count === 0 }
      const frameValue = frame.value
      const frameVelocity = frame.velocity
      let time = 0
      // Per frame (ADR-0025): `dt` clamped once (#78), the part past the delay stepped, a counted loop
      // over the keys writing the run's one Frame in place.
      return (dt) => {
        const clamped = Math.min(dt, MAX_DT)
        time += clamped
        const simDt = Math.max(0, Math.min(clamped, time - delay))
        if (simDt === 0) return frame
        let done = true
        for (let i = 0; i < count; i++) {
          const result = Inertia.step(states[i] as Inertia.State, simDt, resolved[i] as Inertia.Resolved)
          states[i] = result.state
          const key = keys[i] as string
          frameValue[key] = result.value
          frameVelocity[key] = result.velocity
          if (!result.done) done = false
        }
        frame.done = done
        return frame
      }
    },
  })
}

/** A two-axis inertia's frame: its point, and each axis's velocity there. */
export interface PointPhysics extends Frame.Frame<Point.Point> {
  readonly velocity: Point.Point
}

/**
 * Inertia on two axes together: a point each frame, each axis with its own edges, settling once both
 * rest. What a drag's release runs; an animation that takes the release over starts from its velocity.
 */
// The Solid binding's release (ADR-0016, *Amendment (#140)*); taken over from its velocity (#340).
export const inertiaVec = (initial: Point.Point, velocity: Point.Point, options: InertiaVecOptions = NO_OPTIONS): Machine<PointPhysics> =>
  make({
    settles: true,
    span: { name: "wardic.inertiaVec", attributes: {} },
    start: () => {
      const rx = Inertia.resolve(initial.x, velocity.x, { ...options, ...options.x })
      const ry = Inertia.resolve(initial.y, velocity.y, { ...options, ...options.y })
      let x = Inertia.init(initial.x, rx)
      let y = Inertia.init(initial.y, ry)
      // Per frame (ADR-0025): each axis's glide resolved at the run's start, `dt` clamped once (#78).
      return (dt) => {
        const clamped = Math.min(dt, MAX_DT)
        const sx = Inertia.step(x, clamped, rx)
        const sy = Inertia.step(y, clamped, ry)
        x = sx.state
        y = sy.state
        return { value: { x: sx.value, y: sy.value }, velocity: { x: sx.velocity, y: sy.velocity }, done: sx.done && sy.done }
      }
    },
  })

/**
 * A bag of numbers sprung toward `target`: one spring per key on the shared `options`, from `start`'s
 * `from` and `velocity` (else `options.from` and `options.velocity`, else 0), settling once every key
 * rests.
 *
 * Each frame carries a per-key `velocity` beside `value`; a settled key reports 0. Seeding `from` and
 * `velocity` from a frame of the run before keeps its velocity when the target changes. Each frame is
 * rewritten every tick: copy one, or its records, to keep it; the settled frame is stable.
 *
 * @example
 * const card = Machine.springValues({ x: 120, y: 40, scale: 1.1 }, Spring.stiff, { from: { x: 0, y: 0, scale: 1 } })
 */
// Each run steps in place (ADR-0030, decision 11); `toStream` copies each Frame it emits.
export const springValues = (
  target: Readonly<Record<string, number>>,
  options: SpringOptions = NO_OPTIONS,
  start: SpringValuesStart = NO_START,
): Machine<Frame.MultiPhysics> => {
  const { from = NO_START_VALUES, velocity = NO_START_VALUES } = start
  const keys = Rec.keys(target)
  /** A key's start: its own value, else the options', else 0. */
  const startOf = (values: Record<string, number>, key: string, fallback: number | undefined): number =>
    Option.fromNullishOr(values[key]).pipe(
      Option.orElse(() => Option.fromNullishOr(fallback)),
      Option.getOrElse(() => 0),
    )
  const spring = Spring.resolve(options)
  return make({
    settles: true,
    span: { name: "wardic.springValues", attributes: { keys: keys.length } },
    start: () => {
      // One run's state, each key's spring at its index, and the one Frame the run hands out.
      const count = keys.length
      const targets = Arr.map(keys, (key) => UndefinedOr.getOrThrow(target[key]))
      const positions = Arr.map(keys, (key) => startOf(from, key, options.from))
      const velocities = Arr.map(keys, (key) => startOf(velocity, key, options.velocity))
      const elapsed = Arr.map(keys, () => 0)
      // Each key's rest thresholds, by its own distance (#344), as Motion's are per value.
      const restDeltas = Arr.map(keys, (_, i) => Spring.restDeltaFor(spring, targets[i] - positions[i]))
      const restSpeeds = Arr.map(keys, (_, i) => Spring.restSpeedFor(spring, targets[i] - positions[i]))
      // The Frame's records, built from `{}` a key at a time. Built with `Rec.fromEntries`, the
      // step allocated 0.38 MB a frame on Node's `springValues/loop`, against 0.14, and ran slower
      // (ADR-0030, *Implementation in #111*).
      const recordOf = (xs: ReadonlyArray<number>): Record<string, number> =>
        Arr.reduce(keys, {}, (record: Record<string, number>, key, i) => {
          record[key] = xs[i]
          return record
        })
      const frame = { value: recordOf(positions), velocity: recordOf(velocities), done: false }
      const frameValue = frame.value
      const frameVelocity = frame.velocity
      const delay = spring.delay
      // Per frame (ADR-0025, ADR-0030 decisions 10 and 11): `dt` clamped once (#78), then a
      // counted loop over the keys with plain reads, nothing allocated, the run's records and the
      // spring's fields read as this closure's locals. Each key steps by `Spring.step`'s exact
      // step (#370), written out in place: called per key, `Spring.step` returns a new state and
      // result. The keys share one matrix, worked out once a frame. One spring per key gives the
      // same Frames (machines.test.ts).
      const step = (dt: number): Frame.MultiPhysics => {
        const clamped = Math.min(dt, MAX_DT)
        let done = true
        for (let i = 0; i < count; i++) {
          const goal = targets[i]
          const time = elapsed[i] + clamped
          let position = positions[i]
          let speed = velocities[i]
          // Only the part of this tick past the delay moves it.
          const simDt = Math.max(0, Math.min(clamped, time - delay))
          if (simDt > 0) {
            const m = Spring.matrixFor(spring, simDt)
            const d = position - goal
            position = goal + m.dd * d + m.dv * speed
            speed = m.vd * d + m.vv * speed
          }
          const settled = simDt > 0 && Math.abs(speed) <= restSpeeds[i] && Math.abs(position - goal) <= restDeltas[i]
          if (settled) {
            position = goal
            speed = 0
          }
          if (!settled) done = false
          positions[i] = position
          velocities[i] = speed
          elapsed[i] = time
          const key = keys[i]
          frameValue[key] = position
          frameVelocity[key] = speed
        }
        frame.done = done
        return frame
      }
      if (Bool.not(Spring.endsOnTime(spring))) return step
      // A spring that ends at its duration (#359) starts each key from rest, as Motion's, never rests
      // (thresholds no key meets), and lands every key at its duration, after its delay. Set here,
      // around the step, so the step and the arrays every other spring builds stay as they were (a
      // choice per array cost a run's start ~25% on Bun). Every key's time is the run's.
      for (let i = 0; i < count; i++) {
        velocities[i] = 0
        restDeltas[i] = -1
        restSpeeds[i] = -1
        frameVelocity[keys[i]] = 0
      }
      const duration = spring.duration
      let time = 0
      return (dt) => {
        const result = step(dt)
        time += Math.min(dt, MAX_DT)
        if (time - delay < duration) return result
        for (let i = 0; i < count; i++) {
          const goal = targets[i]
          positions[i] = goal
          velocities[i] = 0
          const key = keys[i]
          frameValue[key] = goal
          frameVelocity[key] = 0
        }
        frame.done = true
        return frame
      }
    },
  })
}

// --- The composites ----------------------------------------------------------

const NOT_REPEAT = "Expected a whole number of repeats, 0 or above, or Infinity"

/** A repeat count: a whole number, 0 or above, or `Infinity` to loop forever. */
const Repeat = refine(number, (n) => n === Infinity || (Number.isInteger(n) && n >= 0) || NOT_REPEAT)

/** `animate`'s bag, resolved: its run (its tween's `delay` 0), and the rest as given. */
interface ResolvedAnimate extends ResolvedModifiers {
  readonly run: ResolvedRun
  readonly delay: number
  readonly seconds: number
}

/** The {@link Modifiers}, resolved: as given, defaults filled in. */
interface ResolvedModifiers {
  readonly repeat: number
  readonly repeatDelay: number
  readonly repeatType: "loop" | "reverse" | "mirror"
  readonly reverse: boolean
}

/** The {@link Modifiers}' fields (#66): `animate`'s bag and `keyframes`' (#429) add them to a tween's. */
const ModifierFields = {
  repeat: field(Repeat, 0),
  repeatDelay: field(nonNegative, 0),
  repeatType: field(literals(["loop", "reverse", "mirror"]), "loop"),
  reverse: field(boolean, false),
}

/** A decoded bag's run: its tween played `repeat + 1` times, with its tween's `delay` 0 (held outside, by `delay`). */
const resolvedRunOf = (tween: ResolvedTween, modifiers: ResolvedModifiers): ResolvedRun => {
  const cycle = tween.duration + modifiers.repeatDelay
  return {
    tween: { ...tween, delay: 0 },
    repeats: modifiers.repeat,
    gap: modifiers.repeatDelay,
    cycle,
    total: cycle * (modifiers.repeat + 1) - modifiers.repeatDelay,
    reverses: modifiers.repeatType === "reverse",
    mirrors: modifiers.repeatType === "mirror",
  }
}

/**
 * `animate`'s bag (#66, ADR-0025 *Amendment (#66)*): a tween's fields and the repeat modifiers,
 * checked once a bag. A fractional or negative `repeat`, a negative `repeatDelay`, or a tween field
 * the tween rejects throws its `OptionError`.
 */
const resolveAnimate: (options: AnimateOptions) => ResolvedAnimate = cachedResolver(
  { ...TweenFields, ...ModifierFields },
  (decoded): ResolvedAnimate => {
    const tween = resolvedTweenOf(decoded)
    return {
      run: resolvedRunOf(tween, decoded),
      delay: tween.delay,
      seconds: tween.seconds,
      repeat: decoded.repeat,
      repeatDelay: decoded.repeatDelay,
      repeatType: decoded.repeatType,
      reverse: decoded.reverse,
    }
  },
)

/**
 * A tween that repeats: `repeat` plays it again, `repeatType` turns every other play (`"reverse"`,
 * `"mirror"`), and `reverse` swaps its ends. `delay` holds once, before the first play, as Motion's
 * does, and `repeatDelay` after each play but the last, where it ended. Each play starts the moment the
 * one before ends; a finite `repeat` settles once the last ends, and `repeat: Infinity` never settles.
 *
 * @example
 * const breathe = Machine.animate(1, 1.08, { duration: 1.2, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" })
 */
// #77, #91. One leaf over one frame time, as Motion's `JSAnimation` is (#226): each step adds its `dt`
// (clamped at `MAX_DT`) and reads the run's pass, the time into it and its direction off the total, so a
// tick across a turn paints that tick's value, not the turn. Then `delay(options.delay)`, and its own
// span, `wardic.animate`.
export const animate = (from: number, to: number, options: AnimateOptions = NO_OPTIONS): Machine<Frame.Frame<number>> => {
  const resolved = resolveAnimate(options)
  const { run, repeat, repeatDelay, repeatType, reverse } = resolved
  // Per leg (#460, compose once): statements, and the combinators called data-first.
  let a = from
  let b = to
  if (reverse) {
    a = to
    b = from
  }
  const machine = animateRun(a, b, run, repeat, tweenSpan(a, b, resolved.seconds))
  return withSpan(delay(machine, resolved.delay), "wardic.animate", {
    attributes: { from, to, repeat, repeatDelay, repeatType, reverse },
  })
}

/**
 * `animate`'s run from `a` to `b`. One run, no repeat: nothing to sequence, so the tween's own step,
 * which `runAt` reduces to, and the cheaper per frame (the binding's every tween leg without a `repeat`).
 */
const animateRun = (a: number, b: number, run: ResolvedRun, repeat: number, span: Span): Machine<Frame.Frame<number>> => {
  if (repeat === 0) return tweenLeaf(a, b, run.tween, span)
  return make({
    settles: Number.isFinite(repeat),
    span,
    start: () => {
      let elapsed = 0
      // Per frame (ADR-0025): one time, `dt` clamped (#78); the run resolved when it was built.
      return (dt): Frame.Frame<number> => {
        elapsed += Math.min(dt, MAX_DT)
        return runAt(elapsed, a, b, run)
      }
    },
  })
}

/** `keyframes`' bag resolved (#429): its run (its tween's `delay` 0), an easing per Interval, and each stop's place in time. */
interface ResolvedKeyframes extends ResolvedModifiers {
  readonly run: ResolvedRun
  readonly delay: number
  readonly seconds: number
  readonly eases: Arr.NonEmptyReadonlyArray<Easing.Easing>
  readonly times: ReadonlyArray<number> | undefined
}

/** One `ease` or several (#360): a list is an array whose first item isn't a number, which a bézier's is. */
const EaseOrList = union([EaseDefinition, nonEmptyArray(EaseDefinition)])

/** Whether `times` run from 0 to 1, none before the one ahead of it. */
const inOrder = (times: ReadonlyArray<number>): boolean => {
  // The pairs only once every time is in range (#460, Q8).
  if (!Arr.every(times, (time) => Bool.and(time >= 0, time <= 1))) return false
  return Arr.every(Arr.zip(times, Arr.drop(times, 1)), ([before, after]) => after >= before)
}

const NOT_IN_ORDER = "Expected times from 0 to 1, in order"

/** Each stop's place in time (#429): numbers from 0 to 1, in order. */
const Times = refine(array(finite), (times) => inOrder(times) || NOT_IN_ORDER)

/**
 * `keyframes`' bag (#66): a tween's fields, its `ease` one Definition or one per Interval (#360), its
 * `times` and the repeat modifiers (#429), checked once a bag.
 */
const resolveKeyframes: (options: KeyframesOptions) => ResolvedKeyframes = cachedResolver(
  { ...TweenFields, ...ModifierFields, ease: field(EaseOrList, Easing.linear), times: optionalField(Times) },
  (decoded): ResolvedKeyframes => {
    const list: Arr.NonEmptyReadonlyArray<Easing.Definition> = Bool.match(Bool.and(Arr.isArray(decoded.ease), Bool.not(Easing.isBezier(decoded.ease))), {
      onTrue: () => decoded.ease as Arr.NonEmptyReadonlyArray<Easing.Definition>,
      onFalse: (): Arr.NonEmptyReadonlyArray<Easing.Definition> => [decoded.ease as Easing.Definition],
    })
    const tween = resolvedTweenOf({ ...decoded, ease: list[0] })
    return {
      run: resolvedRunOf(tween, decoded),
      delay: tween.delay,
      seconds: tween.seconds,
      eases: Arr.map(list, Easing.resolve),
      times: decoded.times,
      repeat: decoded.repeat,
      repeatDelay: decoded.repeatDelay,
      repeatType: decoded.repeatType,
      reverse: decoded.reverse,
    }
  },
)

/** Stops a run can go between: a single one twice, so it holds; none, as 0. */
const stopsOf = <A>(stops: ReadonlyArray<A>, none: A): Arr.NonEmptyReadonlyArray<A> =>
  Arr.match(stops, {
    onEmpty: (): Arr.NonEmptyReadonlyArray<A> => [none, none],
    onNonEmpty: (given): Arr.NonEmptyReadonlyArray<A> => Bool.match(given.length === 1, { onTrue: () => [given[0], given[0]], onFalse: () => given }),
  })

/** A keyframes run's span attributes: its modifiers beside its own. */
const keyframesAttributes = (resolved: ResolvedKeyframes, own: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  ...own,
  duration: resolved.seconds,
  repeat: resolved.repeat,
  repeatDelay: resolved.repeatDelay,
  repeatType: resolved.repeatType,
  reverse: resolved.reverse,
})

/**
 * A tween through a list of stops, as Motion's keyframes: each stretch between two stops eased whole by
 * `ease` (one, or one per stretch, wrapping round), each stop at its place in `times` (evenly spaced
 * without one per stop). The repeats run the whole list: `repeat` plays it again, `"reverse"` plays
 * every other pass backwards, `"mirror"` every other pass through the stops from last to first, and
 * `reverse` every pass so. One stop, or none, holds still. `delay` holds once, before the first.
 *
 * @example
 * const shake = Machine.keyframes([0, -12, 12, -6, 6, 0], { duration: 0.5 })
 */
// #429; one leaf over one frame time (#226): the next stretch starts the moment one ends; `delay` once
// (#77). Its own span, `wardic.keyframes`.
export const keyframes = (stops: ReadonlyArray<number>, options: KeyframesOptions = NO_OPTIONS): Machine<Frame.Frame<number>> => {
  const resolved = resolveKeyframes(options)
  const { run, eases, reverse } = resolved
  const at: ReadonlyArray<number> = Arr.copy(stopsOf(stops, 0))
  const last = at.length - 1
  const duration = run.tween.duration
  const stopTimes = stopTimesOf(at.length, resolved.times, duration)
  const machine = make({
    settles: Number.isFinite(resolved.repeat),
    span: tweenSpan(at[0], at[last], resolved.seconds),
    start: () => {
      let elapsed = 0
      const pass: Pass = { within: 0, reversed: false, flipped: false }
      // Per frame (ADR-0025): one time, `dt` clamped (#78); the stops copied when it was built.
      return (dt): Frame.Frame<number> => {
        elapsed += Math.min(dt, MAX_DT)
        const done = passAt(elapsed, run, reverse, pass)
        const time = timeIn(pass, duration)
        const i = intervalAt(time, stopTimes)
        const eased = eases[i % eases.length](intervalProgress(time, stopTimes, i))
        if (pass.flipped) return { value: Scalar.lerp(at[last - i], at[last - i - 1], eased), done }
        return { value: Scalar.lerp(at[i], at[i + 1], eased), done }
      }
    },
  })
  // Per leg (#460): the combinators called data-first.
  return withSpan(delay(machine, resolved.delay), "wardic.keyframes", {
    attributes: keyframesAttributes(resolved, { stops: stops.length }),
  })
}

/** One key's blend at a progress `t`, given whether that progress Frame is the run's last. */
type Blender = InterpolatorRegistry.KeyBlend

/**
 * Each key's blender from `from[key]` (its target when absent) to `to[key]`, built once through the
 * `InterpolatorRegistry`.
 *
 * - **A Key rule first** (ADR-0035): the Environment's rule for the key by name, when one takes the
 *   pair, gives the key's whole blend. Core holds none. `@wardic/dom`'s keep a key that hides an
 *   element at its old value until the run's last Frame (ADR-0024, decision 4), grow a value from its
 *   Animatable none (ADR-0015, *Amendment (#61)*), and blend a list item by item.
 * - **Else by value**: the registry's blend. A pair it can't blend is a Discrete pair and switches
 *   at the first Frame past 0 (ADR-0024, decision 3).
 */
const blendersFor: (
  from: Readonly<Values.Values>,
  to: Readonly<Values.Values>,
) => Effect.Effect<ReadonlyArray<readonly [key: string, blend: Blender]>, never, InterpolatorRegistry.InterpolatorRegistry> =
  // Per leg (#460): one Effect a key, in `to`'s order, and no record built between.
  Effect.fnUntraced(function* (from: Readonly<Values.Values>, to: Readonly<Values.Values>) {
    const registry = yield* InterpolatorRegistry.InterpolatorRegistry
    const keys = Rec.keys(to)
    const blenders = yield* Effect.forEach(keys, (key) => blenderFor(registry, key, startOf(from, key, to[key]), to[key]))
    return Arr.zip(keys, blenders)
  })

/** `key`'s start in `from`, else its target `b`: a statement (#460), as `Rec.get` reads an own key. */
const startOf = (from: Values.Values, key: string, b: number | string): number | string => {
  if (!Object.hasOwn(from, key)) return b
  return from[key]
}

/** `key`'s blender from `a` to `b` ({@link blendersFor}'s, and each of a keyframes Interval's, #429). */
const blenderFor = (registry: InterpolatorRegistry.InterpolatorRegistry["Service"], key: string, a: number | string, b: number | string): Effect.Effect<Blender> =>
  // No rule takes it: the registry's blend, through a blender made here, as before #61. A blender
  // made by one shared factory for every key made its call site megamorphic, and Node's string
  // workloads 7–9% slower per frame (#61's bench).
  Option.getOrElse(registry.keyBlendOf(key, a, b), () => Effect.map(registry.resolve(a, b), (blend): Blender => (t) => blend(t)))

/**
 * Every key's blend at one progress Frame. On the per-frame path (ADR-0025): a loop over the
 * `[key, blender]` pairs built with the machine, not `Rec.map`, which spreads the record and then
 * reassigns every key (#63 measured `Rec.map` 1.6× this loop in Chromium, 2.3× in JSC).
 */
const blendAt = (
  blenders: ReadonlyArray<readonly [key: string, blend: Blender]>,
  t: number,
  done: boolean,
): Frame.Frame<Values.Values> => {
  const value: Record<string, number | string> = {}
  for (const pair of blenders) value[pair[0]] = pair[1](t, done)
  return { value, done }
}

/**
 * A bag of values tweened from `from` to `to`, each key blended as its Environment blends it: numbers,
 * unit strings, complex values, and its own kinds, such as `@wardic/dom`'s colours. One tween drives every
 * key, so the repeats and `delay` apply to the whole bag. A pair that can't blend switches at the first
 * frame; the Environment can hold a key until the last, as `@wardic/dom` does a key that hides an element.
 * Building it needs the `InterpolatorRegistry`, once.
 *
 * @example
 * const fade = yield* Machine.animateValues({ opacity: 0, color: "#bf616a" }, { opacity: 1, color: "#a3be8c" }, { duration: 0.3 })
 */
// One `animate(0, 1, options)` progress drives every key; `done` is its Frame's. Key rules: ADR-0024,
// ADR-0035. The registry is consulted once: each key resolves to a pure blender; per tick,
// `keys.length` direct calls.
export const animateValues = (
  from: Readonly<Values.Values>,
  to: Readonly<Values.Values>,
  options: AnimateOptions = NO_OPTIONS,
): Effect.Effect<Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  // Per leg (#460): the combinators called data-first.
  Effect.map(blendersFor(from, to), (blenders) =>
    withSpan(
      map(animate(0, 1, options), (progress) => blendAt(blenders, progress.value, progress.done)),
      "wardic.animateValues",
      { attributes: { keys: blenders.length } },
    ))

/**
 * A bag of values blended from `from` to `to` by one spring's progress: the spring runs from rest on a
 * 0 to 100 progress, and each key is blended at progress / 100. It's how a spring moves values that
 * aren't numbers, a colour or a unit string, as Motion's spring does.
 *
 * - **The progress spans 0 to 100**, as a number going 100 would, so `restDelta` and `restSpeed` mean
 *   the same for both, and a string key beside an `x` going 0 to 100 lands with it.
 * - **It starts from rest:** `options.from` and `options.velocity` don't move it.
 * - **Past 1**, a key does what its blend does past 1: a number or a unit string overshoots, and
 *   `@wardic/dom`'s colour holds at its target. A pair that can't blend switches at its first frame.
 */
// ADR-0024, decision 5: `springValues` on a 0→100 progress, each key through the `InterpolatorRegistry`.
// As Motion runs a spring on a string (motion-dom animation/JSAnimation.ts:132-148 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8); its default thresholds a move of 100's (#344).
export const springBlend = (
  from: Readonly<Values.Values>,
  to: Readonly<Values.Values>,
  options: SpringOptions = NO_OPTIONS,
): Effect.Effect<Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  // Per leg (#460): the combinators called data-first.
  Effect.map(blendersFor(from, to), (blenders) =>
    withSpan(
      map(springValues({ progress: 100 }, options, { from: { progress: 0 }, velocity: { progress: 0 } }), (frame) =>
        blendAt(blenders, UndefinedOr.getOrThrow(frame.value.progress) / 100, frame.done)),
      "wardic.springBlend",
      { attributes: { keys: blenders.length } },
    ))

/**
 * One key's keyframes in a bag (#429): its stops' times in a pass, and a blender for each Interval,
 * read from first to last (`forward`) and, when a pass can read them from last to first, that way
 * too (`backward`), as Motion's mirrored generator builds its own.
 */
interface Track {
  readonly key: string
  readonly stopTimes: ReadonlyArray<number>
  readonly forward: ReadonlyArray<Blender>
  readonly backward: ReadonlyArray<Blender>
}

/** No blenders: a Track whose passes never read its stops from last to first. */
const NO_BLENDERS: ReadonlyArray<Blender> = []

/** `key`'s blender for each Interval through `stops` (two or more). */
const intervalBlenders = (
  registry: InterpolatorRegistry.InterpolatorRegistry["Service"],
  key: string,
  stops: ReadonlyArray<number | string>,
): Effect.Effect<ReadonlyArray<Blender>> =>
  Effect.all(Arr.map(Arr.range(0, stops.length - 2), (i) => blenderFor(registry, key, stops[i], stops[i + 1])))

/** `key`'s Track through `given` in a pass of `duration` seconds, its stops at `times` when there's one each. */
const trackFor = (
  registry: InterpolatorRegistry.InterpolatorRegistry["Service"],
  key: string,
  given: Arr.NonEmptyReadonlyArray<number | string>,
  times: ReadonlyArray<number> | undefined,
  duration: number,
  flips: boolean,
): Effect.Effect<Track> => {
  const stops = stopsOf(given, given[0])
  return Effect.all({
    forward: intervalBlenders(registry, key, stops),
    backward: Bool.match(flips, { onTrue: () => intervalBlenders(registry, key, Arr.reverse(stops)), onFalse: () => Effect.succeed(NO_BLENDERS) }),
  }).pipe(Effect.map(({ forward, backward }): Track => ({ key, stopTimes: stopTimesOf(stops.length, times, duration), forward, backward })))
}

/**
 * A bag of values through each key's stops, as Motion's keyframes, each key blended as its Environment
 * blends it, as `animateValues`' are. One run drives every key: its `duration`, `ease` (one, or one per
 * stretch) and repeats are the bag's. Each key has its own stops, at their places in `times` when there's
 * one per stop, evenly spaced otherwise. A key with one stop holds it, and one with none is left out.
 * Building it needs the `InterpolatorRegistry`, once.
 */
// #429. An Interval blends as a pair does: a Discrete pair switches at its first Frame past 0, and a Key
// rule that holds a key until the run's last Frame (`@wardic/dom`'s for a key that hides an element) sees only the
// last Interval's. Each Interval of each key resolves to a pure blender; per tick, one direct call a key.
// Its own span, `wardic.keyframesValues`.
export const keyframesValues: (
  stops: Readonly<Record<string, ReadonlyArray<number | string>>>,
  options?: KeyframesOptions,
) => Effect.Effect<Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry> = Effect.fnUntraced(
  function* (stops: Readonly<Record<string, ReadonlyArray<number | string>>>, options: KeyframesOptions = NO_OPTIONS) {
    const resolved = resolveKeyframes(options)
    const { run, eases, reverse } = resolved
    const registry = yield* InterpolatorRegistry.InterpolatorRegistry
    const flips = Bool.or(reverse, run.mirrors)
    const duration = run.tween.duration
    const tracks = yield* Effect.all(
      Arr.filterMap(Rec.toEntries(stops), ([key, given]) =>
        Arr.match(given, {
          onEmpty: () => Result.failVoid,
          onNonEmpty: (some) => Result.succeed(trackFor(registry, key, some, resolved.times, duration, flips)),
        })),
    )
    const machine = make({
      settles: Number.isFinite(resolved.repeat),
      span: { name: "wardic.keyframesValues", attributes: {} },
      start: () => {
        let elapsed = 0
        const pass: Pass = { within: 0, reversed: false, flipped: false }
        // Per frame (ADR-0025): one time, `dt` clamped (#78); a loop over the Tracks built with the machine.
        return (dt): Frame.Frame<Values.Values> => {
          elapsed += Math.min(dt, MAX_DT)
          const done = passAt(elapsed, run, reverse, pass)
          const time = timeIn(pass, duration)
          const value: Record<string, number | string> = {}
          for (const track of tracks) {
            const i = intervalAt(time, track.stopTimes)
            const eased = eases[i % eases.length](intervalProgress(time, track.stopTimes, i))
            let blenders = track.forward
            if (pass.flipped) blenders = track.backward
            value[track.key] = blenders[i](eased, done)
          }
          return { value, done }
        }
      },
    })
    // Per leg (#460): the combinators called data-first.
    return withSpan(delay(machine, resolved.delay), "wardic.keyframesValues", {
      attributes: keyframesAttributes(resolved, { keys: tracks.length }),
    })
  },
)
