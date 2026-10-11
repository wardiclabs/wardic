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
import * as Stream from "effect/Stream"
import type { Covariant } from "effect/Types"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Clock from "./Clock.ts"
import type * as Easing from "./Easing.ts"
import type * as Frame from "./Frame.ts"
import * as FrameLoop from "./FrameLoop.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import {
  DEFAULT_DURATION,
  initDecay,
  initTween,
  resolveDecay,
  type ResolvedTween,
  resolveTween,
  stepDecay,
  stepTween,
  valueOr,
} from "./internal/stepper.ts"
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
 * Long frame stalls (tab switches, slow first paints, debugger pauses) can produce `dt` values
 * measured in seconds, large enough to teleport a spring across its rest thresholds or blow up a
 * decay integration. Every constructor clamps each step's `dt` here once (#78), in its leaves'
 * steps and in `delay`'s hold, so both drivers clamp and no stepper needs to defend itself.
 * Inline, not a `clampDt` layer: a layer is one more call per element per frame, which V8
 * doesn't inline (ADR-0028, *Implementation in #94*).
 *
 * 500ms is permissive by design: it accommodates the synthetic frame samples our unit tests use
 * (which push the engine with 0.25s–0.5s deltas) while still capping the multi-second deltas a
 * tab-switch can produce. Live 60fps frames (~16ms) are unaffected.
 */
export const MAX_DT = 0.5

// --- The option bags ---------------------------------------------------------
//
// Durations and delays are in seconds, matching the public `transition: { duration: 0.3 }`
// surface and the `dt` the Clock emits.

/** Options for a definite, duration-based animation. */
export interface TweenOptions {
  /** Duration in seconds. Default 0.3 s: a missing duration leaves the other options as they are (#107). */
  readonly duration?: number
  /** Easing function; defaults to linear. */
  readonly easing?: Easing.Easing
  /**
   * Delay before the animation starts, in seconds. With `animate`'s `repeat` / `yoyo`, or across
   * `keyframes`' stops, it holds once, before the first segment (#77): `Machine.delay`.
   */
  readonly delay?: number
}

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

/** Repeat / lifecycle modifiers shared across primitives. */
export interface Modifiers {
  /**
   * Additional repeats after the first run. `Infinity` loops forever. Default 0. Each repeat
   * starts on the tick after the one before it settles, or after its `repeatDelay`: `delay` holds
   * once, before the first run (#77).
   */
  readonly repeat?: number
  /**
   * A gap between repeats, in seconds (Motion's `repeatDelay`, #91). Default 0. Each run but the
   * last holds where it ended (with `yoyo`, its turning point) for this long, then the next run
   * starts on the tick after; an infinite `repeat` holds after every run.
   */
  readonly repeatDelay?: number
  /** Reverse direction on alternate repeats (ping-pong). Default false. */
  readonly yoyo?: boolean
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
 * beginning, with no leftover time carried over.
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
 * re-stamped `done: false`. A `self` that never settles never reaches `that`. `concatAll` of the
 * two; keeps `self`'s span.
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
 * Frame is re-stamped `done: false`, so a run never settles. A `self` that never settles is
 * returned as it is. Keeps `self`'s span.
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
 * `self` settles. A `self` that never settles is returned as it is, and so is `holdAfter(0)` (or
 * a negative hold).
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
  ).pipe(Stream.withSpan(self.span.name, { attributes: self.span.attributes }))

/**
 * Run `self` on the Frame loop, from the loop's next tick, handing each Frame to `sink`: a plain
 * call, typed `(frame) => undefined`, so a sink that returns an Effect doesn't compile (ADR-0027,
 * decision 8). Succeeds with the settled Frame; a machine that never settles runs until
 * interrupted. Dies if the step or the sink throws, or with the loop's own failure. Interrupting
 * it removes the run at once. One span per run, with a `<name>: start` debug log.
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

/** A tween's duration as its options give it, or 0.3 s. Not on the per-frame path: read when it's built. */
const durationOr = (options: TweenOptions): number => valueOr(options.duration, DEFAULT_DURATION)

/** A definite, duration-based animation from `from` to `to`. Its `delay` is its stepper's. */
export const tween = (from: number, to: number, options: TweenOptions): Machine<Frame.Frame<number>> =>
  tweenLeaf(from, to, resolveTween(options), tweenSpan(from, to, durationOr(options)))

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
export const spring = (target: number, options: SpringOptions = {}): Machine<Frame.Physics> => {
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
export const chase = (getTarget: () => number, options: SpringOptions = {}): Machine<Frame.Physics> => {
  const resolved = Spring.resolve(options)
  return make({
    settles: false,
    span: { name: "wardic.chase", attributes: { stiffness: resolved.stiffness, damping: resolved.damping } },
    start: springRun(getTarget, resolved, options),
  })
}

/** Momentum/decay motion: fling from `initial` at `velocity`, slowed by friction. */
export const decay = (initial: number, velocity: number, options: DecayOptions = {}): Machine<Frame.Physics> => {
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
 * fling's tail: `Drag.fling`'s, and the Solid binding's release.
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
 * Spring a bag of numeric values toward `target`: one spring per key with the shared `options`,
 * from `from` / `velocity` (default 0 / `options.from` / `options.velocity`), settling once
 * every key is at rest.
 *
 * Each Frame carries a per-key `velocity` map beside `value`, straight from each spring's step;
 * a settled key reports 0. Seeding both `from` and `velocity` from a prior Frame makes a
 * velocity-preserving retarget: momentum stays continuous across the handoff.
 */
export const springValues = (
  target: Record<string, number>,
  options: SpringOptions = {},
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
      let states: Rec.ReadonlyRecord<string, Spring.State> = Rec.map(target, (_, key) =>
        Spring.init({
          ...options,
          from: startOf(from, key, options.from),
          velocity: startOf(velocity, key, options.velocity),
        }),
      )
      // Per frame (ADR-0025): `dt` clamped once (#78), then a loop over the keys, every key's
      // state and target present by construction. Records, as before: #63's bench measured an array of states, filled by
      // `push` and destructured, at +18% bytes per frame.
      return (dt) => {
        const clamped = Math.min(dt, MAX_DT)
        const nextStates: Record<string, Spring.State> = {}
        const values: Record<string, number> = {}
        const velocities: Record<string, number> = {}
        let allDone = true
        for (const key of keys) {
          const state = UndefinedOr.getOrThrow(states[key])
          const result = Spring.step(state, clamped, UndefinedOr.getOrThrow(target[key]), spring)
          nextStates[key] = result.state
          values[key] = result.value
          velocities[key] = result.velocity
          if (!result.done) allDone = false
        }
        states = nextStates
        return { value: values, velocity: velocities, done: allDone }
      }
    },
  })
}

// --- The composites ----------------------------------------------------------

/** A missing number option, read once: its value, or `fallback`. */
const numberOr = (value: number | undefined, fallback: number): number =>
  Option.getOrElse(Option.fromNullishOr(value), () => fallback)

/**
 * A tween with modifiers: `reverse` swaps the endpoints, `repeat` replays, and `yoyo` turns
 * each replay around. `delay` holds once, before the first segment, as Motion's does (#77), and
 * `repeatDelay` holds after each segment but the last, where it ended (`holdAfter`, #91): with
 * `yoyo`, at its turning point, as Motion's `repeatType: "reverse"` does.
 *
 * - **Finite `repeat: N`** runs N+1 segments (`concatAll`), and only the last Frame carries
 *   `done: true`. A fractional `repeat` (1.5) runs ceil(N+1) segments and settles on the last.
 * - **`repeat: Infinity`** runs the first segment, then a cycle of the rest without end
 *   (`concat(first, forever(concatAll(rest)))`): one segment, or a backward and forward pair
 *   with `yoyo`, each segment holding after it. It never settles; it ends when its run is
 *   removed.
 *
 * Then `delay(options.delay)`, and its own span, `wardic.animate`. Each segment's tween clamps
 * its `dt` at `MAX_DT`, and so does the hold.
 */
export const animate = (from: number, to: number, options: AnimateOptions = {}): Machine<Frame.Frame<number>> => {
  const reverse = Option.getOrElse(Option.fromNullishOr(options.reverse), () => false)
  const repeats = numberOr(options.repeat, 0)
  const yoyo = options.yoyo === true
  const [a, b] = Bool.match(reverse, { onTrue: () => [to, from] as const, onFalse: () => [from, to] as const })
  // Every segment's tween: `delay` holds once, outside them.
  const segment = resolveTween({ ...options, delay: 0 })
  const gap = numberOr(options.repeatDelay, 0)
  const forward = tweenLeaf(a, b, segment, tweenSpan(a, b, durationOr(options)))
  const backward = tweenLeaf(b, a, segment, tweenSpan(b, a, durationOr(options)))
  // The segments a run holds after: every one but the last (`holdAfter(0)` is its input).
  const forwardHeld = holdAfter(forward, gap)
  const backwardHeld = holdAfter(backward, gap)
  /** Segment `i`: `yoyo`'s odd segments run backwards. */
  const segmentFor = (i: number): Machine<Frame.Frame<number>> =>
    Bool.match(yoyo && i % 2 === 1, { onTrue: () => backward, onFalse: () => forward })
  /** Segment `i`, holding after it. */
  const heldFor = (i: number): Machine<Frame.Frame<number>> =>
    Bool.match(yoyo && i % 2 === 1, { onTrue: () => backwardHeld, onFalse: () => forwardHeld })
  return Bool.match(Number.isFinite(repeats), {
    onTrue: () => {
      const count = Math.ceil(Math.max(0, repeats) + 1)
      // Every segment but the last holds after it.
      return concatAll(
        Arr.makeBy(count, (i) => Bool.match(i === count - 1, { onTrue: () => segmentFor(i), onFalse: () => heldFor(i) })),
      )
    },
    onFalse: () =>
      concat(
        heldFor(0),
        forever(
          concatAll(
            Bool.match(yoyo, {
              onTrue: (): Arr.NonEmptyReadonlyArray<Machine<Frame.Frame<number>>> => [heldFor(1), heldFor(2)],
              onFalse: (): Arr.NonEmptyReadonlyArray<Machine<Frame.Frame<number>>> => [heldFor(1)],
            }),
          ),
        ),
      ),
  }).pipe(
    delay(numberOr(options.delay, 0)),
    withSpan("wardic.animate", { attributes: { from, to, repeat: repeats, repeatDelay: gap, yoyo, reverse } }),
  )
}

/**
 * Animate through a sequence of stops, splitting `duration` evenly across the segments between
 * them (`concatAll`); a single stop, or none, holds still for `duration`. `delay` holds once,
 * before the first stop's segment (#77). Its own span, `wardic.keyframes`.
 */
export const keyframes = (stops: ReadonlyArray<number>, options: TweenOptions): Machine<Frame.Frame<number>> => {
  const pairs = Arr.zip(stops, Arr.drop(stops, 1))
  const total = durationOr(options)
  const duration = total / Math.max(1, pairs.length)
  const segment = resolveTween({ ...options, duration, delay: 0 })
  return Arr.match(pairs, {
    onEmpty: () => {
      const only = Option.getOrElse(Arr.head(stops), () => 0)
      return tweenLeaf(only, only, segment, tweenSpan(only, only, duration))
    },
    onNonEmpty: (nonEmpty) =>
      concatAll(Arr.map(nonEmpty, ([a, b]) => tweenLeaf(a, b, segment, tweenSpan(a, b, duration)))),
  }).pipe(
    delay(numberOr(options.delay, 0)),
    withSpan("wardic.keyframes", { attributes: { stops: stops.length, duration: total } }),
  )
}

/** One key's blend at a progress `t`, given whether that progress Frame is the run's last. */
type Blender = (t: number, done: boolean) => number | string

/** The keys whose turn to `none` or `hidden` waits for the run's last Frame (ADR-0024, decision 4). */
const VISIBILITY_KEYS: ReadonlySet<string> = new Set(["display", "visibility"])
const INVISIBLE: ReadonlySet<string> = new Set(["none", "hidden"])

/** A `none` or `hidden` value: what a `display` or `visibility` key turns to when it hides. */
const isInvisible: Predicate.Refinement<unknown, string> = Predicate.compose(
  Predicate.isString,
  (value: string) => INVISIBLE.has(value.trim()),
)

/** One key with the values it blends from and to. */
type KeyedPair = readonly [key: string, from: number | string, to: number | string]

/** A `display` or `visibility` key. */
const isVisibilityKey: Predicate.Predicate<string> = (key) => VISIBILITY_KEYS.has(key)

/** A pair that hides: a `display` or `visibility` key, from a visible value to `none` or `hidden`. */
const hides: Predicate.Predicate<KeyedPair> = Predicate.Tuple([isVisibilityKey, Predicate.not(isInvisible), isInvisible])

/** A hiding pair's blender: it shows `from` until the run's last Frame, then `to`. Per frame: a statement `if`. */
const holdUntilDone =
  (from: number | string, to: number | string): Blender =>
  (_t, done) => {
    if (done) return to
    return from
  }

/**
 * Each key's blender from `from[key]` (its target when absent) to `to[key]`, resolved through
 * the `InterpolatorRegistry` once. A pair the registry can't blend is a Discrete pair and
 * switches at the first Frame past 0 (ADR-0024, decision 3). `display` and `visibility`, by
 * name, turning from any other value to `none` or `hidden`, switch on the run's last Frame
 * instead (decision 4): Motion's `mixVisibility` (motion-dom utils/mix/visibility.ts:1-14 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8), keyed on the Frame's `done` rather than on progress
 * 1, so a spring's progress crossing 1 and back can't flicker it.
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
        return Option.liftPredicate([key, a, b] as const, hides).pipe(
          Option.map(([, shown, hidden]) => holdUntilDone(shown, hidden)),
          Option.match({
            onNone: () => Effect.map(registry.resolve(a, b), (blend): Blender => (t) => blend(t)),
            onSome: Effect.succeed,
          }),
        )
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
 * (numbers, colours and unit strings). One `animate(0, 1, options)` progress drives every key,
 * so the modifiers (`reverse`, `repeat`, `yoyo`, an infinite `repeat`, `delay`) apply to the
 * bag as a whole, and `done` is the progress Frame's. A Discrete pair switches at the first
 * Frame; `display` and `visibility` turn `none` / `hidden` on the last (ADR-0024).
 *
 * Building it needs the `InterpolatorRegistry`, consulted once: each key resolves to a pure
 * blender. Its steps don't: per tick, `keys.length` direct calls.
 */
export const animateValues = (
  from: Values.Values,
  to: Values.Values,
  options: AnimateOptions = {},
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
 *   `restVelocity` mean the same for both, and a colour beside an `x` going 0 → 100 lands with it.
 * - It always starts from rest: `options.from` and `options.velocity` don't move it. A velocity
 *   in a key's units has no meaning on the progress.
 * - Past 1, a colour holds at its target (culori clamps its progress) and a unit string or
 *   number overshoots. A Discrete pair switches at the first Frame past the delay; `display`
 *   and `visibility` turn `none` / `hidden` on the settle Frame.
 */
export const springBlend = (
  from: Values.Values,
  to: Values.Values,
  options: SpringOptions = {},
): Effect.Effect<Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.map(blendersFor(from, to), (blenders) =>
    springValues({ progress: 100 }, options, { progress: 0 }, { progress: 0 }).pipe(
      map((frame) => blendAt(blenders, UndefinedOr.getOrThrow(frame.value.progress) / 100, frame.done)),
      withSpan("wardic.springBlend", { attributes: { keys: Rec.keys(to).length } }),
    ))
