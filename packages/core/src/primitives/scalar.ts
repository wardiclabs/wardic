import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type { AnimateOptions, DecayOptions, SpringOptions, TweenOptions } from "../options.ts"
import type { Clock } from "../services/Clock.ts"
import { chaseCore, chaseMachine } from "./chase.ts"
import { type Frame, MAX_DT, type PhysicsFrame } from "./frame.ts"
import { cycle, inSequence, type Machine, type MachineSpan, toStream } from "./machine.ts"
import { initDecay, initTween, resolveDecay, resolveSpring, resolveTween, stepDecay, stepTween } from "./stepper.ts"

/**
 * A leaf Primitive's `Stream`: its machine over `Clock.ticks` (`toStream`), emitting one `Frame`
 * per tick and stopping (inclusively) on the first settled frame. The whole stream runs inside a
 * span named after the machine, carrying its parameters as attributes, and emits a debug log
 * (annotated with the same attributes) on subscribe. Per-frame work is deliberately un-logged:
 * it is the hot path, and keeps ADR-0025's per-frame forms. The machine's step clamps `dt` at
 * `MAX_DT` at the engine boundary, so every primitive inherits jank protection without each
 * stepper needing to defend itself.
 */
const fromClock = <F extends Frame<unknown>>(machine: Machine<F>): Stream.Stream<F, never, Clock> =>
  Stream.unwrap(
    Effect.logDebug(`${machine.span.name}: subscribe`).pipe(
      Effect.as(toStream(machine)),
      Effect.annotateLogs(machine.span.attributes),
    ),
  ).pipe(Stream.withSpan(machine.span.name, { attributes: machine.span.attributes }))

/** Stamp every frame's `done` to a fixed boolean — used to splice tween legs. */
const withDone = <V>(stream: Stream.Stream<Frame<V>, never, Clock>, done: boolean) =>
  stream.pipe(Stream.map((frame) => ({ value: frame.value, done }) as Frame<V>))

/** `tween`'s machine (ADR-0027): the resolved tween stepped from 0 elapsed. */
export const tweenMachine = (from: number, to: number, options: TweenOptions): Machine<Frame<number>> => {
  const resolved = resolveTween(options)
  return {
    settles: true,
    span: { name: "wardic.tween", attributes: { from, to, duration: options.duration } },
    start: () => {
      let state = initTween()
      // Per frame (ADR-0025): the tween resolved above, `dt` clamped at the engine boundary.
      return (dt) => {
        const result = stepTween(state, Math.min(dt, MAX_DT), from, to, resolved)
        state = result.state
        return { value: result.value, done: result.done }
      }
    },
  }
}

/** A definite, duration-based animation from `from` to `to`. */
export const tween = (
  from: number,
  to: number,
  options: TweenOptions,
): Stream.Stream<Frame<number>, never, Clock> => fromClock(tweenMachine(from, to, options))

/** `spring`'s machine (ADR-0027): `chase`'s, toward a static `target`, settling at rest. */
export const springMachine = (target: number, options: SpringOptions = {}): Machine<PhysicsFrame> => {
  const { stiffness, damping } = resolveSpring(options)
  return {
    start: chaseMachine(() => target, options).start,
    settles: true,
    span: { name: "wardic.spring", attributes: { target, stiffness, damping } },
  }
}

/**
 * Interruptible spring motion toward a static `target` (starts at `options.from`,
 * default 0). Implemented as the shared `chaseCore` with `Stream.takeUntil` on
 * `done`, so a static target settles and completes; a moving target is the
 * `chase` primitive's job.
 */
export const spring = (
  target: number,
  options: SpringOptions = {},
): Stream.Stream<PhysicsFrame, never, Clock> => {
  const { stiffness, damping } = resolveSpring(options)
  const attributes = { target, stiffness, damping }
  return Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.spring: subscribe")
      return chaseCore(() => target, options).pipe(
        Stream.takeUntil((frame: PhysicsFrame) => frame.done),
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.spring", { attributes }))
}

/** Momentum/decay motion: fling from `initial` at `velocity`, slowed by friction. */
export const decay = (
  initial: number,
  velocity: number,
  options: DecayOptions = {},
): Stream.Stream<PhysicsFrame, never, Clock> => fromClock(decayMachine(initial, velocity, options))

/** `decay`'s machine (ADR-0027): the resolved decay stepped from `initial` at `velocity`. */
export const decayMachine = (initial: number, velocity: number, options: DecayOptions = {}): Machine<PhysicsFrame> => {
  const resolved = resolveDecay(options)
  return {
    settles: true,
    span: { name: "wardic.decay", attributes: { initial, velocity, friction: resolved.friction } },
    start: () => {
      let state = initDecay(initial, velocity)
      // Per frame (ADR-0025): the decay resolved above, `dt` clamped at the engine boundary.
      return (dt) => {
        const result = stepDecay(state, Math.min(dt, MAX_DT), resolved)
        state = result.state
        return { value: result.value, velocity: result.velocity, done: result.done }
      }
    },
  }
}

const DEFAULT_ANIMATE: AnimateOptions = { duration: 0.3 }

type Segment = Stream.Stream<Frame<number>, never, Clock>

/** Segments played one after another, as one run. */
const segmentsInSequence = (segments: Arr.NonEmptyReadonlyArray<Segment>): Segment =>
  Arr.reduce(Arr.tailNonEmpty(segments), Arr.headNonEmpty(segments), (out, segment) => Stream.concat(out, segment))

/** A segment of a run: re-stamped to `done: false` unless it's the last, so consumers see a single settle. */
const segmentOfRun = (segment: Segment, last: boolean): Segment =>
  Bool.match(last, { onTrue: () => segment, onFalse: () => withDone(segment, false) })

/** `animate`'s options, read once: its endpoints in order, its repeats and whether it yoyos. */
const animatePlan = (from: number, to: number, options: AnimateOptions) => {
  const reverse = Option.getOrElse(Option.fromNullishOr(options.reverse), () => false)
  const repeats = Option.getOrElse(Option.fromNullishOr(options.repeat), () => 0)
  const yoyo = options.yoyo === true
  const [a, b] = Bool.match(reverse, { onTrue: () => [to, from] as const, onFalse: () => [from, to] as const })
  /** Whether segment `i` runs backwards (`yoyo`'s odd segments). */
  const backwards = (i: number): boolean => yoyo && i % 2 === 1
  const span: MachineSpan = { name: "wardic.animate", attributes: { from, to, repeat: repeats, yoyo, reverse } }
  return { a, b, repeats, yoyo, backwards, span }
}

/**
 * Tween with modifiers. Honors `reverse` (swap endpoints), `repeat` (replays),
 * and `yoyo` (alternate direction each replay).
 *
 * Finite `repeat: N` runs N+1 segments and only the last frame carries `done: true`;
 * intermediate segments are re-stamped to `done: false` so consumers see a single
 * settle. `repeat: Infinity` uses `Stream.forever` over a cycle of segments (one segment
 * when `yoyo` is off, a forward+backward pair when on) — the resulting stream
 * never settles on its own and ends only when the consumer or the Clock does.
 */
export const animate = (
  from: number,
  to: number,
  options: AnimateOptions = DEFAULT_ANIMATE,
): Stream.Stream<Frame<number>, never, Clock> => {
  const { a, b, backwards, repeats, span, yoyo } = animatePlan(from, to, options)

  const segmentFor = (i: number): Segment =>
    Bool.match(backwards(i), { onTrue: () => tween(b, a, options), onFalse: () => tween(a, b, options) })

  return Bool.match(Number.isFinite(repeats), {
    // Infinite repeat: forever over a one- or two-segment cycle. Every emitted frame
    // carries `done: false` — the stream's only termination is consumer/Clock.
    onFalse: () =>
      Stream.forever(
        Bool.match(yoyo, {
          onTrue: () => Stream.concat(withDone(segmentFor(0), false), withDone(segmentFor(1), false)),
          onFalse: () => withDone(segmentFor(0), false),
        }),
      ),
    onTrue: () => {
      const runs = Math.max(0, repeats) + 1
      return segmentsInSequence(Arr.makeBy(Math.ceil(runs), (i) => segmentOfRun(segmentFor(i), i === runs - 1)))
    },
  }).pipe(Stream.withSpan(span.name, { attributes: span.attributes }))
}

/**
 * `animate`'s machine (ADR-0027): its segments' tween machines, in sequence, or cycled for an
 * infinite `repeat`, with the same Frames as its `Stream` on a live Clock. A fractional `repeat`
 * is the one difference: the `Stream` runs its last segment re-stamped and ends with no settled
 * Frame, and the machine settles on it.
 */
export const animateMachine = (
  from: number,
  to: number,
  options: AnimateOptions = DEFAULT_ANIMATE,
): Machine<Frame<number>> => {
  const { a, b, backwards, repeats, span, yoyo } = animatePlan(from, to, options)

  const segmentFor = (i: number): Machine<Frame<number>> =>
    Bool.match(backwards(i), { onTrue: () => tweenMachine(b, a, options), onFalse: () => tweenMachine(a, b, options) })

  return Bool.match(Number.isFinite(repeats), {
    onFalse: () =>
      cycle(
        Bool.match(yoyo, {
          onTrue: (): Arr.NonEmptyReadonlyArray<Machine<Frame<number>>> => [segmentFor(0), segmentFor(1)],
          onFalse: (): Arr.NonEmptyReadonlyArray<Machine<Frame<number>>> => [segmentFor(0)],
        }),
        span,
      ),
    onTrue: () => inSequence(Arr.makeBy(Math.ceil(Math.max(0, repeats) + 1), segmentFor), span),
  })
}

/** Sugar: animate from a known current value to `to` (e.g. interrupting). */
export const animateFrom = (
  current: number,
  to: number,
  options: AnimateOptions = DEFAULT_ANIMATE,
): Stream.Stream<Frame<number>, never, Clock> => animate(current, to, options)

/** `keyframes`' span. */
const keyframesSpan = (stops: ReadonlyArray<number>, options: TweenOptions): MachineSpan => ({
  name: "wardic.keyframes",
  attributes: { stops: stops.length, duration: options.duration },
})

/** Animate through a sequence of stops, splitting `duration` evenly across segments. */
export const keyframes = (
  stops: ReadonlyArray<number>,
  options: TweenOptions,
): Stream.Stream<Frame<number>, never, Clock> => {
  const span = keyframesSpan(stops, options)
  // One segment per pair of consecutive stops; a single stop (or none) holds still for `duration`.
  return Arr.match(Arr.zip(stops, Arr.drop(stops, 1)), {
    onEmpty: () => {
      const only = Option.getOrElse(Arr.head(stops), () => 0)
      return tween(only, only, options)
    },
    onNonEmpty: (pairs) => {
      const segmentOptions = { ...options, duration: options.duration / pairs.length }
      const last = pairs.length - 1
      return segmentsInSequence(Arr.map(pairs, ([from, to], i) => segmentOfRun(tween(from, to, segmentOptions), i === last)))
    },
  }).pipe(Stream.withSpan(span.name, { attributes: span.attributes }))
}

/** `keyframes`' machine (ADR-0027): one tween machine per pair of stops, in sequence. */
export const keyframesMachine = (stops: ReadonlyArray<number>, options: TweenOptions): Machine<Frame<number>> => {
  const span = keyframesSpan(stops, options)
  return Arr.match(Arr.zip(stops, Arr.drop(stops, 1)), {
    onEmpty: () => {
      const only = Option.getOrElse(Arr.head(stops), () => 0)
      return { ...tweenMachine(only, only, options), span }
    },
    onNonEmpty: (pairs) => {
      const segmentOptions = { ...options, duration: options.duration / pairs.length }
      return inSequence(Arr.map(pairs, ([from, to]) => tweenMachine(from, to, segmentOptions)), span)
    },
  })
}
