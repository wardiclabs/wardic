/**
 * The `Machine` module (ADR-0028): a Primitive's motion as a value. A machine is what a
 * Primitive does on each tick, apart from how the ticks reach it, so a Primitive is its machine
 * (ADR-0027, ADR-0028 decision 4). Two drivers run it, with the same Frames either way:
 * - **`toStream`,** a `Stream` over `Clock.ticks`, one fiber per subscriber (Tier 2, ADR-0001);
 * - **`run(sink)`,** the **Frame loop**, which steps every running machine in one pass per tick.
 *
 * Each opens the machine's one span per run (`span`), with its `<name>: subscribe` or
 * `<name>: start` debug log.
 *
 * - **Build** one with a constructor, one per Primitive (`tween`, `spring`, `decay`, `chase`,
 *   `animate`, `keyframes`, `springValues`, `decayVec`; `springBlend` and `animateValues`
 *   return an `Effect` needing the `InterpolatorRegistry`), or with `make`.
 * - **Compose** with the combinators, each `dual` where it takes more than the machine: `map`,
 *   `concat`, `concatAll`, `forever`, `delay`, `holdAfter`, `clampDt`, `withSpan`. They run when
 *   a machine is built, never per step: a combinator's `start()` starts its inner machine, and
 *   its step makes plain calls only, allocating only the Frame it returns, and only when it
 *   changes it (ADR-0028, decision 7). Defaults add no layer: `delay(0)`, `holdAfter(0)` and a
 *   one-segment `concatAll` return their input.
 * - **A machine is `Pipeable`, never a literal.** `make` and the constructors build it on a
 *   prototype, so `m.pipe(Machine.delay(0.1))` works and `isMachine` recognises it. Never
 *   spread one: `{ ...m, span }` has no prototype. `withSpan` replaces a span.
 *
 * Tier 2 (ADR-0008): for binding and Environment authors.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { dual, identity } from "effect/Function"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { Covariant } from "effect/Types"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Clock from "./Clock.ts"
import type * as Easing from "./Easing.ts"
import type * as Frame from "./Frame.ts"
import * as FrameLoop from "./FrameLoop.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import { cachedResolver, field, NonNegative } from "./internal/options.ts"
import {
  durationOf,
  initDecay,
  initTween,
  keyframesAt,
  resolveDecay,
  type ResolvedRun,
  type ResolvedTween,
  resolvedTweenOf,
  resolveTween,
  runAt,
  stepDecay,
  stepTween,
  TweenFields,
} from "./internal/stepper.ts"
import * as Inertia from "./Inertia.ts"
import type * as Point from "./Point.ts"
import * as Spring from "./Spring.ts"
import type * as Values from "./Values.ts"

// --- The data type -----------------------------------------------------------

const TypeId = "~@wardic/core/Machine"

/**
 * A Primitive's motion as a value (ADR-0027): what it does on each tick, apart from how the
 * ticks reach it. Built by a constructor or `make`, never written as a literal.
 */
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
  /** The span each run gets, on either driver: its Primitive's name and attributes (decision 6). */
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

/** A machine from its fields: a run's `start`, whether it `settles`, and its `span` (decision 6). */
export const make = <F extends Frame.Frame<unknown>>(fields: {
  readonly start: () => (dt: number) => F
  readonly settles: boolean
  readonly span: Span
}): Machine<F> => Object.assign(Object.create(Proto), fields)

/** Whether `u` is a machine (built by `make` or a constructor). */
export const isMachine = (u: unknown): u is Machine<Frame.Frame<unknown>> => Predicate.hasProperty(u, TypeId)

/**
 * Maximum delta-time (seconds) any Primitive simulates in one step.
 *
 * Every constructor clamps each step's `dt` here once (#78), in its leaves' steps and in `delay`'s
 * hold, so both drivers clamp and no stepper needs to defend itself; dom's projection pass clamps
 * its own. Inline, not a `clampDt` layer: a layer is one more call per element per frame, which V8
 * doesn't inline (ADR-0028, *Implementation in #94*).
 *
 * Why 500 ms (#23, ADR-0017 *Amendment (#23)*):
 * - **A stall up to it reaches each consumer whole,** so a tween, a spring, decay, inertia or a
 *   layout animation lands where wall time puts it, as Motion's time-based animations do: every
 *   jank short of a tab switch or a debugger pause.
 * - **A longer one (a hidden tab) advances it 500 ms,** and the animation plays out the rest, where
 *   Motion's jumps to its end. It bounds the spring's cost too: it's integrated in 1/240 s substeps,
 *   so a minute away would be 14,400 a spring on return.
 *
 * A sequence's seams drop the rest of a tick, a stall's included (#226).
 */
export const MAX_DT = 0.5

// --- The option bags ---------------------------------------------------------
//
// Durations and delays are in seconds, matching the public `transition: { duration: 0.3 }`
// surface and the `dt` the Clock emits. Each bag is a Schema's encoded side (#66, ADR-0025
// *Amendment (#66)*): decoded once a bag, when an animation is built, filling in its defaults; a
// value no animation can take throws its `SchemaError`, naming the field.

/** Options for a definite, duration-based animation. */
export interface TweenOptions {
  /** Duration in seconds. Default 0.3 s: a missing duration leaves the other options as they are (#107). */
  readonly duration?: number
  /** Easing function; defaults to linear. */
  readonly easing?: Easing.Easing
  /**
   * Delay before the animation starts, in seconds. With `animate`'s `repeat` / `repeatType`, or across
   * `keyframes`' stops, it holds once, before the first segment (#77): `Machine.delay`.
   */
  readonly delay?: number
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

/** Options for interruptible spring motion. */
export interface SpringOptions {
  /** Starting position. Default 0. */
  readonly from?: number
  /** Spring constant — higher is snappier. Default 170. */
  readonly stiffness?: number
  /** Damping — higher settles faster with less overshoot. Default 26. */
  readonly damping?: number
  /** Mass of the moving object. Default 1. */
  readonly mass?: number
  /** Initial velocity (units/second). Default 0. */
  readonly velocity?: number
  /** Rest threshold for position delta from target. Default 0.01. */
  readonly restDelta?: number
  /** Rest threshold for velocity. Default 0.01. */
  readonly restVelocity?: number
  /** Delay before the animation starts, in seconds. */
  readonly delay?: number
}

/** Options for momentum/decay motion (fling math). */
export interface DecayOptions {
  /** Exponential friction coefficient — higher stops sooner. Default 3. */
  readonly friction?: number
  /** Velocity below which motion is considered at rest. Default 0.1. */
  readonly restVelocity?: number
  /** Delay before the animation starts, in seconds. */
  readonly delay?: number
}

/**
 * Options for an inertia (ADR-0016, *Amendment (#140)*, Motion's `inertia`): a glide toward
 * `power` × the velocity that eases out over `timeConstant`, and springs back on the bounce at an
 * edge it would cross, or starts past. Times in seconds, as every option bag here (Motion's
 * `timeConstant` is in milliseconds).
 */
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

/** Repeat / lifecycle modifiers shared across primitives. */
export interface Modifiers {
  /**
   * Additional repeats after the first run: a whole number, or `Infinity` to loop forever.
   * Default 0. Each repeat starts the moment the one before it ends, or its `repeatDelay` after,
   * wherever that falls in a tick (#226): `delay` holds once, before the first run (#77).
   */
  readonly repeat?: number
  /**
   * A gap between repeats, in seconds (Motion's `repeatDelay`, #91). Default 0. Each run but the
   * last holds where it ended (a turned run, at its turning point) for this long; an infinite
   * `repeat` holds after every run.
   */
  readonly repeatDelay?: number
  /**
   * How every other repeat runs (Motion's `repeatType`, #226). Default `"loop"`.
   * - `"loop"`: each run starts at `from` again.
   * - `"reverse"`: every other run plays backwards in time, from `to` to `from` on the easing's
   *   curve reversed: an `easeOut` run comes back easing in.
   * - `"mirror"`: every other run plays from `to` to `from` on the same easing: an `easeOut` run
   *   comes back easing out.
   */
  readonly repeatType?: "loop" | "reverse" | "mirror"
  /** Run the animation from `to` back to `from`. Default false. */
  readonly reverse?: boolean
}

/** Options accepted by `animate` and `animateValues`. */
export interface AnimateOptions extends TweenOptions, Modifiers {}

// --- The combinators ---------------------------------------------------------

/** `frame`, re-stamped `done: false`: a seam's one allocation. */
const unsettled = <F extends Frame.Frame<unknown>>(frame: F): F => ({ ...frame, done: false })

/** `self` with each Frame mapped by `f`, which runs per frame (ADR-0025). Keeps `self`'s span. */
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
 * Segments played one after another, as one run: `Stream.concat`'s seam over N segments, flat,
 * with one step through them (ADR-0027, decision 4). A segment's settled Frame is re-stamped
 * `done: false` unless it's the last, and the next segment starts on the next tick, from its
 * beginning, with no leftover time carried over: the rest of the tick a segment ends in is
 * dropped, so a sequence runs up to a frame a seam behind wall time. For tweens in sequence, time-
 * exact, `keyframes` and `animate` are one leaf over one time (#226).
 *
 * A segment that never settles (`chase`, `forever`) is the last one reached, as a `Stream` that
 * never ends is in `Stream.concat`: the rest are dropped. One segment is returned as it is. Keeps
 * the first segment's span. Effect v3's name: v4 has no `Stream.concatAll`.
 */
export const concatAll = <F extends Frame.Frame<unknown>>(segments: Arr.NonEmptyReadonlyArray<Machine<F>>): Machine<F> => {
  const reached = Option.match(
    Arr.findFirstIndex(segments, (segment) => !segment.settles),
    {
      onNone: () => segments,
      onSome: (endless): Arr.NonEmptyReadonlyArray<Machine<F>> => [
        Arr.headNonEmpty(segments),
        ...Arr.take(Arr.tailNonEmpty(segments), endless),
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
 * `that` on the tick after `self` settles: `Stream.concat`'s seam, `self`'s settled Frame
 * re-stamped `done: false`, the rest of that tick dropped (`concatAll`'s, #226). A `self` that
 * never settles never reaches `that`. `concatAll` of the two; keeps `self`'s span.
 */
export const concat: {
  <G extends Frame.Frame<unknown>>(that: Machine<G>): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F | G>
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(self: Machine<F>, that: Machine<G>): Machine<F | G>
} = dual(
  2,
  <F extends Frame.Frame<unknown>, G extends Frame.Frame<unknown>>(self: Machine<F>, that: Machine<G>): Machine<F | G> =>
    concatAll<F | G>([self, that]),
)

/**
 * `self` restarted on the tick after it settles, without end: `Stream.forever`'s. Each settled
 * Frame is re-stamped `done: false`, so a run never settles, and the rest of the tick it settled
 * in is dropped, so each restart runs up to a frame behind wall time; `animate`'s `repeat:
 * Infinity` is time-exact (#226). A `self` that never settles is returned as it is. Keeps `self`'s
 * span.
 */
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
 * A hold before `self`'s first step: `Effect.delay`'s word. For `seconds`, each tick returns
 * the Frame `self` starts at (its step at 0, re-stamped `done: false`), the same object every
 * held tick. The held time counts each tick's `dt` at most `MAX_DT`, as a step does, and on the
 * tick it reaches `seconds`, `self` steps the time left over. A negative `seconds` starts `self`
 * that far in. `delay(0)` is `self`. Keeps `self`'s span.
 *
 * Not the steppers' own `delay`, which a leaf keeps (dom's projection pass steps springs by hand
 * with it): a Frame after this hold can differ from the stepper's in its last bit, since the
 * hold is subtracted at a different point (ADR-0028, decision 9).
 */
export const delay: {
  (seconds: number): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, seconds: number): Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, seconds: number): Machine<F> =>
    Bool.match(seconds === 0, {
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
 * A hold after `self` settles (CONTEXT.md's Hold): its settled Frame, re-stamped `done: false`
 * once, is returned on the tick it settles and on every held tick, the same object, until the
 * held time reaches `seconds`; on that tick it settles with `self`'s settled Frame. The held
 * time counts each tick's `dt` at most `MAX_DT`, as a step does, and starts on the tick after
 * `self` settles, so the rest of that tick is dropped (`animate`'s `repeatDelay` is time-exact,
 * #226). A `self` that never settles is returned as it is, and so is `holdAfter(0)` (or a negative
 * hold).
 * Keeps `self`'s span. Effect has no hold after; #91's name.
 */
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

/**
 * `self` with each `dt` clamped at `max` before its step. Keeps `self`'s span. The constructors
 * clamp at `MAX_DT` already, inline (#78); this is for a machine built with `make`.
 */
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
 * `self` under the span `name`, with `options.attributes` as given: it replaces `self`'s span,
 * since a machine's span is data until a driver opens it (decision 6). A composite names
 * itself this way, and so can an app (`m.pipe(Machine.withSpan("app.bounce"))`). `dual` as
 * `Stream.withSpan` is, told apart by its first argument.
 */
export const withSpan: {
  (name: string, options?: SpanOptions): <F extends Frame.Frame<unknown>>(self: Machine<F>) => Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, name: string, options?: SpanOptions): Machine<F>
} = dual(
  (args) => isMachine(args[0]),
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
 * Run `self` over `Clock.ticks`: one Frame per tick, through its first settled Frame when it
 * settles. Each subscription starts its own run, under the machine's one span, with a
 * `<name>: subscribe` debug log annotated with the span's attributes. Per-frame work is
 * un-logged: it is the hot path.
 *
 * Each emission is its consumer's to keep: a record Frame is copied (`owned`) before it's
 * emitted, so a consumer that collects Frames never sees one rewritten (ADR-0030, decision 11).
 */
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
  ).pipe(Stream.withSpan(self.span.name, { attributes: self.span.attributes, captureStackTrace: false }))

/**
 * Run `self` on the Frame loop, from the loop's next tick, handing each Frame to `sink`: a plain
 * call, typed `(frame) => undefined`, so a sink that returns an Effect doesn't compile (ADR-0027,
 * decision 8). Succeeds with the settled Frame; a machine that never settles runs until
 * interrupted. Dies if the step or the sink throws, or with the loop's own failure. Interrupting
 * it removes the run at once. One span per run, with a `<name>: start` debug log.
 *
 * A Frame handed to `sink` is the run's until the next tick, so a sink that keeps one copies it:
 * `springValues` rewrites one Frame per run (ADR-0030, decision 11). The settled Frame it succeeds
 * with is stable: nothing steps after a settle.
 *
 * A machine built with a service runs under its Effect: `Effect.flatMap(Machine.run(sink))`.
 */
export const run: {
  <F extends Frame.Frame<unknown>>(sink: FrameLoop.Sink<F>): (self: Machine<F>) => Effect.Effect<F, never, FrameLoop.FrameLoop>
  <F extends Frame.Frame<unknown>>(self: Machine<F>, sink: FrameLoop.Sink<F>): Effect.Effect<F, never, FrameLoop.FrameLoop>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine<F>, sink: FrameLoop.Sink<F>): Effect.Effect<F, never, FrameLoop.FrameLoop> =>
    FrameLoop.FrameLoop.use((loop) => loop.run(self, sink)),
)

// --- The leaves --------------------------------------------------------------

/** A tween's step from 0 elapsed: `tween`'s, and each of `animate`'s and `keyframes`' segments. */
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

/** A definite, duration-based animation from `from` to `to`. Its `delay` is its stepper's. */
export const tween = (from: number, to: number, options: TweenOptions): Machine<Frame.Frame<number>> => {
  const resolved = resolveTween(options)
  return tweenLeaf(from, to, resolved, tweenSpan(from, to, resolved.seconds))
}

/**
 * The spring stepper toward `getTarget()`, read afresh on every step, so a moving target is
 * followed without stale snapshots: `chase`'s run, and `spring`'s toward a static target.
 */
const springRun =
  (getTarget: () => number, spring: Spring.Resolved, options: SpringOptions) => (): ((dt: number) => Frame.Physics) => {
    let state = Spring.init(options)
    // Per frame (ADR-0025): the spring resolved when the machine is built, `dt` clamped (#78).
    return (dt) => {
      const result = Spring.step(state, Math.min(dt, MAX_DT), getTarget(), spring)
      state = result.state
      return { value: result.value, velocity: result.velocity, done: result.done }
    }
  }

/**
 * Spring motion toward a static `target`, from `options.from` (default 0), settling at rest. A
 * moving target is `chase`'s.
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
 * Spring motion that follows a continuously moving target. `getTarget()` is read on every
 * step, so the chase tracks a target that keeps moving (a cursor follower, scroll-linked UI, a
 * retargeted snap). Its Frames report rest, but it never settles: a run ends only when it's
 * removed (the Stream's subscriber cancels, or the run is interrupted).
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
 * Momentum/decay motion: fling from `initial` at `velocity`, slowed by friction. Stepped in closed
 * form (#23), so it comes to rest `velocity / friction` from `initial` whatever the frame rate.
 */
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

/**
 * Two-axis decay: both axes stepped together, one `Point` per tick, settling once both rest. A
 * Fling's tail: the Solid binding's release.
 */
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
 * Inertia (ADR-0016, *Amendment (#140)*, Motion's `inertia`): a glide from `initial` at `velocity`
 * toward `initial + power × velocity` (or where `modifyTarget` moves it), easing out over
 * `timeConstant`; where it would cross `min` or `max`, or starts past one, a spring back to that edge
 * on the bounce. What a drag's release runs: a Fling, and a snap back to the origin (both edges 0).
 */
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

/**
 * Two-axis inertia: both axes stepped together, one `Point` per tick, each with its own edges,
 * settling once both rest. A drag's release in the Solid binding (ADR-0016, *Amendment (#140)*).
 */
export const inertiaVec = (initial: Point.Point, velocity: Point.Point, options: InertiaVecOptions = NO_OPTIONS): Machine<Frame.Frame<Point.Point>> =>
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
        return { value: { x: sx.value, y: sy.value }, done: sx.done && sy.done }
      }
    },
  })

/**
 * Spring a bag of numeric values toward `target`: one spring per key with the shared `options`,
 * from `from` / `velocity` (default 0 / `options.from` / `options.velocity`), settling once
 * every key is at rest.
 *
 * Each Frame carries a per-key `velocity` map beside `value`, straight from each spring's step;
 * a settled key reports 0. Seeding both `from` and `velocity` from a prior Frame makes a
 * velocity-preserving retarget: momentum stays continuous across the handoff.
 *
 * Each run steps in place (ADR-0030, decision 11): it rewrites one Frame, its `value` and its
 * `velocity`, every tick. A sink that keeps a Frame, or either record, copies it; the settled
 * Frame is stable, since nothing steps after a settle. `toStream` copies each one it emits.
 */
export const springValues = (
  target: Record<string, number>,
  options: SpringOptions = NO_OPTIONS,
  from: Record<string, number> = {},
  velocity: Record<string, number> = {},
): Machine<Frame.MultiPhysics> => {
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
      const { stiffness, damping, mass, restDelta, restVelocity, delay } = spring
      // Per frame (ADR-0025, ADR-0030 decisions 10 and 11): `dt` clamped once (#78), then a
      // counted loop over the keys with plain reads, nothing allocated, the run's records and the
      // spring's fields read as this closure's locals. Each key steps by `Spring.step`'s
      // integration, written out in place: called per key, `Spring.step` returns a new state and
      // result. One spring per key gives the same Frames (machines.test.ts).
      return (dt) => {
        const clamped = Math.min(dt, MAX_DT)
        let done = true
        for (let i = 0; i < count; i++) {
          const goal = targets[i]
          const time = elapsed[i] + clamped
          let position = positions[i]
          let speed = velocities[i]
          // Only the part of this tick past the delay is integrated.
          const simDt = Math.max(0, Math.min(clamped, time - delay))
          if (simDt > 0) {
            // `Spring.step`'s 1/240 s substep, as a literal, which V8 folds: dividing by a module
            // constant ran Node's `springValues/loop` about 3% slower (ADR-0030, *Implementation in #111*).
            const substeps = Math.max(1, Math.ceil(simDt / (1 / 240)))
            const h = simDt / substeps
            for (let s = 0; s < substeps; s++) {
              const springForce = -stiffness * (position - goal)
              const dampingForce = -damping * speed
              speed += ((springForce + dampingForce) / mass) * h
              position += speed * h
            }
          }
          const settled = simDt > 0 && Math.abs(speed) < restVelocity && Math.abs(position - goal) < restDelta
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
    },
  })
}

// --- The composites ----------------------------------------------------------

/** A repeat count: a whole number, 0 or above, or `Infinity` to loop forever. */
const Repeat = Schema.Number.check(
  Schema.makeFilter((n: number) =>
    Bool.match(Bool.or(n === Infinity, Bool.and(Number.isInteger(n), n >= 0)), {
      onTrue: () => true,
      onFalse: () => "Expected a whole number of repeats, 0 or above, or Infinity",
    }),
  ),
)

/** `animate`'s bag, resolved: its run (its tween's `delay` 0), and the rest as given. */
interface ResolvedAnimate {
  readonly run: ResolvedRun
  readonly delay: number
  readonly seconds: number
  readonly repeat: number
  readonly repeatDelay: number
  readonly repeatType: "loop" | "reverse" | "mirror"
  readonly reverse: boolean
}

/**
 * `animate`'s bag as a Schema (#66, ADR-0025 *Amendment (#66)*): a tween's fields and the repeat
 * modifiers, decoded once a bag. A fractional or negative `repeat`, a negative `repeatDelay`, or a
 * tween field the tween rejects throws its `SchemaError`.
 */
const resolveAnimate: (options: AnimateOptions) => ResolvedAnimate = cachedResolver(
  {
    ...TweenFields,
    repeat: field(Repeat, 0),
    repeatDelay: field(NonNegative, 0),
    repeatType: field(Schema.Literals(["loop", "reverse", "mirror"]), "loop"),
    reverse: field(Schema.Boolean, false),
  },
  (decoded): ResolvedAnimate => {
    const tween = resolvedTweenOf(decoded)
    const cycle = tween.duration + decoded.repeatDelay
    return {
      run: {
        tween: { ...tween, delay: 0 },
        repeats: decoded.repeat,
        gap: decoded.repeatDelay,
        cycle,
        total: cycle * (decoded.repeat + 1) - decoded.repeatDelay,
        reverses: decoded.repeatType === "reverse",
        mirrors: decoded.repeatType === "mirror",
      },
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
 * A tween with modifiers: `reverse` swaps the endpoints, `repeat` replays, and `repeatType` turns
 * every other replay (`"reverse"`, `"mirror"`). `delay` holds once, before the first run, as
 * Motion's does (#77), and `repeatDelay` holds after each run but the last, where it ended (#91).
 *
 * One leaf over one frame time, as Motion's `JSAnimation` is (#226): each step adds its `dt`
 * (clamped at `MAX_DT`) and reads the run's pass, the time into it and its direction off the total,
 * so a pass starts the moment the one before it ends, wherever that falls in a tick, and a tick
 * across a turn paints that tick's value, not the turn. A finite `repeat` settles once its last
 * pass ends; `repeat: Infinity` never settles, and ends when its run is removed.
 *
 * Then `delay(options.delay)`, and its own span, `wardic.animate`.
 */
export const animate = (from: number, to: number, options: AnimateOptions = NO_OPTIONS): Machine<Frame.Frame<number>> => {
  const resolved = resolveAnimate(options)
  const { run, repeat, repeatDelay, repeatType, reverse } = resolved
  const [a, b] = Bool.match(reverse, { onTrue: () => [to, from] as const, onFalse: () => [from, to] as const })
  const span = tweenSpan(a, b, resolved.seconds)
  // One run, no repeat: nothing to sequence, so the tween's own step, which `runAt` reduces to, and
  // the cheaper per frame (the binding's every tween leg without a `repeat`).
  return Bool.match(repeat === 0, {
    onTrue: () => tweenLeaf(a, b, run.tween, span),
    onFalse: () =>
      make({
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
      }),
  }).pipe(
    delay(resolved.delay),
    withSpan("wardic.animate", { attributes: { from, to, repeat, repeatDelay, repeatType, reverse } }),
  )
}

/**
 * Animate through a sequence of stops, splitting `duration` evenly across the Segments between
 * them, each eased whole (Motion's keyframes, evenly spaced). One leaf over one frame time (#226):
 * the next Segment starts the moment one ends, wherever that falls in a tick. A single stop, or
 * none, holds still for `duration`. `delay` holds once, before the first Segment (#77). Its own
 * span, `wardic.keyframes`.
 */
export const keyframes = (stops: ReadonlyArray<number>, options: TweenOptions): Machine<Frame.Frame<number>> => {
  const resolved = resolveTween(options)
  const total = resolved.seconds
  const count = Math.max(1, stops.length - 1)
  const segment = durationOf(total / count)
  const at: ReadonlyArray<number> = Arr.copy(stops)
  return Arr.match(Arr.drop(stops, 1), {
    onEmpty: () => {
      const only = Option.getOrElse(Arr.head(stops), () => 0)
      return tweenLeaf(only, only, { ...resolved, delay: 0 }, tweenSpan(only, only, total))
    },
    onNonEmpty: () =>
      make({
        settles: true,
        span: tweenSpan(Option.getOrElse(Arr.head(stops), () => 0), Option.getOrElse(Arr.last(stops), () => 0), total),
        start: () => {
          let elapsed = 0
          // Per frame (ADR-0025): one time, `dt` clamped (#78); the stops copied when it was built.
          return (dt): Frame.Frame<number> => {
            elapsed += Math.min(dt, MAX_DT)
            return keyframesAt(elapsed, at, segment, total, resolved.easing)
          }
        },
      }),
  }).pipe(
    delay(resolved.delay),
    withSpan("wardic.keyframes", { attributes: { stops: stops.length, duration: total } }),
  )
}

/** One key's blend at a progress `t`, given whether that progress Frame is the run's last. */
type Blender = InterpolatorRegistry.KeyBlend

/**
 * Each key's blender from `from[key]` (its target when absent) to `to[key]`, built once through the
 * `InterpolatorRegistry`.
 *
 * - **A Key rule first** (ADR-0035): the Environment's rule for the key by name, when one takes the
 *   pair, gives the key's whole blend. Core holds none. The DOM's turn `display` / `visibility` to
 *   `none` / `hidden` on the run's last Frame (ADR-0024, decision 4), grow a shadow, filter or fill
 *   from its Animatable none (ADR-0015, *Amendment (#61)*), and blend shadow lists shadow by shadow.
 * - **Else by value**: the registry's blend. A pair it can't blend is a Discrete pair and switches
 *   at the first Frame past 0 (ADR-0024, decision 3).
 */
const blendersFor = (
  from: Values.Values,
  to: Values.Values,
): Effect.Effect<ReadonlyArray<readonly [key: string, blend: Blender]>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.gen(function* () {
    const registry = yield* InterpolatorRegistry.InterpolatorRegistry
    const blenders = yield* Effect.all(
      Rec.map(to, (b, key): Effect.Effect<Blender> => {
        const a = Option.getOrElse(Rec.get(from, key), () => b)
        // No rule takes it: the registry's blend, through a blender made here, as before #61. A
        // blender made by one shared factory for every key made its call site megamorphic, and
        // Node's string workloads 7–9% slower per frame (#61's bench).
        return Option.getOrElse(registry.keyBlendOf(key, a, b), () =>
          Effect.map(registry.resolve(a, b), (blend): Blender => (t) => blend(t)))
      }),
    )
    return Rec.toEntries(blenders)
  })

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
 * Animate a bag of values from `from` to `to`, each key through the `InterpolatorRegistry`
 * (numbers, unit strings, complex values, and its Environment's own kinds, the DOM's colours).
 * One `animate(0, 1, options)` progress drives every key, so the modifiers (`reverse`, `repeat`,
 * `repeatType`, `repeatDelay`, `delay`) apply to the bag as a whole, and `done` is the progress
 * Frame's. A Discrete pair switches at the first Frame; an Environment's Key rule can hold a key
 * until the last (the DOM's `display` and `visibility`, ADR-0024 and ADR-0035).
 *
 * Building it needs the `InterpolatorRegistry`, consulted once: each key resolves to a pure
 * blender. Its steps don't: per tick, `keys.length` direct calls.
 */
export const animateValues = (
  from: Values.Values,
  to: Values.Values,
  options: AnimateOptions = NO_OPTIONS,
): Effect.Effect<Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.map(blendersFor(from, to), (blenders) =>
    animate(0, 1, options).pipe(
      map((progress) => blendAt(blenders, progress.value, progress.done)),
      withSpan("wardic.animateValues", { attributes: { keys: Rec.keys(to).length } }),
    ))

/**
 * Blend a bag of values from `from` to `to` by one spring's progress (ADR-0024, decision 5):
 * a spring with `options` (stiffness, damping, mass, rest thresholds, `delay`) runs from rest on
 * a 0→100 progress (`springValues`), and each key is blended through the `InterpolatorRegistry`
 * at progress / 100. It's how a spring's string keys follow the spring, as Motion runs a spring
 * on a string (motion-dom animation/JSAnimation.ts:132-148 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8).
 *
 * - The progress spans 0–100 as a numeric key travelling 100 would, so `restDelta` and
 *   `restVelocity` mean the same for both, and a string key beside an `x` going 0 → 100 lands with it.
 * - It always starts from rest: `options.from` and `options.velocity` don't move it. A velocity
 *   in a key's units has no meaning on the progress.
 * - Past 1, a key does what its Interpolator does past 1: a unit string or number overshoots, and
 *   one that clamps its progress holds at its target (the DOM's colours). A Discrete pair switches
 *   at the first Frame past the delay; an Environment's Key rule can hold a key until the settle
 *   Frame (the DOM's `display` and `visibility`).
 */
export const springBlend = (
  from: Values.Values,
  to: Values.Values,
  options: SpringOptions = NO_OPTIONS,
): Effect.Effect<Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.map(blendersFor(from, to), (blenders) =>
    springValues({ progress: 100 }, options, { progress: 0 }, { progress: 0 }).pipe(
      map((frame) => blendAt(blenders, UndefinedOr.getOrThrow(frame.value.progress) / 100, frame.done)),
      withSpan("wardic.springBlend", { attributes: { keys: Rec.keys(to).length } }),
    ))
