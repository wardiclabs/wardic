import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type { AnimateOptions, DecayOptions, SpringOptions, TweenOptions } from "../options.ts"
import { Clock } from "../services/Clock.ts"
import { chaseCore } from "./chase.ts"
import { type Frame, MAX_DT, type PhysicsFrame } from "./frame.ts"
import {
  initDecay,
  initTween,
  type PhysicsStepResult,
  resolveDecay,
  resolveSpring,
  resolveTween,
  type StepResult,
  stepDecay,
  stepTween,
} from "./stepper.ts"

/**
 * Drives a pure stepper over `Clock.ticks`, emitting one `Frame` per tick and
 * stopping (inclusively) on the first settled frame. This is the single bridge
 * between the pure physics and the Effect world; every scalar primitive is a
 * one-line call to it.
 *
 * The `toFrame` builder lifts a `StepResult` into the primitive's frame shape
 * — definite primitives produce `Frame<number>`, physics primitives produce
 * `PhysicsFrame` by threading `velocity` from the step state. Frames flow
 * through to consumers verbatim; the only termination mechanism is
 * `Stream.takeUntil((f) => f.done)`.
 *
 * Observability: the whole stream runs inside a span named `span` carrying the
 * primitive's parameters as attributes, and emits a debug log (annotated with
 * the same attributes) on subscribe. Per-frame work is deliberately un-logged —
 * it is the hot path, and keeps ADR-0025's per-frame forms: `step` reads options the
 * primitive resolved when it built the stream.
 */
const fromClock = <S, V, R extends StepResult<S, V>, F extends Frame<V>>(
  span: string,
  attributes: Record<string, unknown>,
  init: () => S,
  step: (state: S, dt: number) => R,
  toFrame: (result: R) => F,
): Stream.Stream<F, never, Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug(`${span}: subscribe`)
      const clock = yield* Clock
      return clock.ticks.pipe(
        Stream.mapAccum(init, (state, dt) => {
          // Clamp at the engine boundary so every primitive inherits jank
          // protection without each stepper needing to defend itself.
          const clampedDt = Math.min(dt, MAX_DT)
          const result = step(state, clampedDt)
          return [result.state, [toFrame(result)]] as const
        }),
        Stream.takeUntil((frame: F) => frame.done),
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan(span, { attributes }))

/** Lift a definite-primitive step into a plain `Frame<number>`. */
const definiteFrame = <S>(result: StepResult<S, number>): Frame<number> => ({
  value: result.value,
  done: result.done,
})

/** Lift a physics-primitive step into a `PhysicsFrame` carrying velocity. */
const physicsFrame = <S>(result: PhysicsStepResult<S>): PhysicsFrame => ({
  value: result.value,
  velocity: result.velocity,
  done: result.done,
})

/** Stamp every frame's `done` to a fixed boolean — used to splice tween legs. */
const withDone = <V>(stream: Stream.Stream<Frame<V>, never, Clock>, done: boolean) =>
  stream.pipe(Stream.map((frame) => ({ value: frame.value, done }) as Frame<V>))

/** A definite, duration-based animation from `from` to `to`. */
export const tween = (
  from: number,
  to: number,
  options: TweenOptions,
): Stream.Stream<Frame<number>, never, Clock> => {
  const resolved = resolveTween(options)
  return fromClock(
    "wardic.tween",
    { from, to, duration: options.duration },
    initTween,
    (state, dt) => stepTween(state, dt, from, to, resolved),
    definiteFrame,
  )
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
): Stream.Stream<PhysicsFrame, never, Clock> => {
  const resolved = resolveDecay(options)
  return fromClock(
    "wardic.decay",
    { initial, velocity, friction: resolved.friction },
    () => initDecay(initial, velocity),
    (state, dt) => stepDecay(state, dt, resolved),
    physicsFrame,
  )
}

const DEFAULT_ANIMATE: AnimateOptions = { duration: 0.3 }

type Leg = Stream.Stream<Frame<number>, never, Clock>

/** Legs played one after another, as one run. */
const inSequence = (legs: Arr.NonEmptyReadonlyArray<Leg>): Leg =>
  Arr.reduce(Arr.tailNonEmpty(legs), Arr.headNonEmpty(legs), (out, leg) => Stream.concat(out, leg))

/** A leg of a run: re-stamped to `done: false` unless it's the last, so consumers see a single settle. */
const legOfRun = (leg: Leg, last: boolean): Leg =>
  Bool.match(last, { onTrue: () => leg, onFalse: () => withDone(leg, false) })

/**
 * Tween with modifiers. Honors `reverse` (swap endpoints), `repeat` (replays),
 * and `yoyo` (alternate direction each replay).
 *
 * Finite `repeat: N` runs N+1 legs and only the last frame carries `done: true`;
 * intermediate legs are re-stamped to `done: false` so consumers see a single
 * settle. `repeat: Infinity` uses `Stream.forever` over a cycle of legs (one leg
 * when `yoyo` is off, a forward+backward pair when on) — the resulting stream
 * never settles on its own and ends only when the consumer or the Clock does.
 */
export const animate = (
  from: number,
  to: number,
  options: AnimateOptions = DEFAULT_ANIMATE,
): Stream.Stream<Frame<number>, never, Clock> => {
  const reverse = Option.getOrElse(Option.fromNullishOr(options.reverse), () => false)
  const repeats = Option.getOrElse(Option.fromNullishOr(options.repeat), () => 0)
  const yoyo = options.yoyo === true
  const [a, b] = Bool.match(reverse, { onTrue: () => [to, from] as const, onFalse: () => [from, to] as const })

  const legFor = (i: number): Leg =>
    Bool.match(yoyo && i % 2 === 1, { onTrue: () => tween(b, a, options), onFalse: () => tween(a, b, options) })

  const spanAttributes = { from, to, repeat: repeats, yoyo, reverse }

  return Bool.match(Number.isFinite(repeats), {
    // Infinite repeat: forever over a one- or two-leg cycle. Every emitted frame
    // carries `done: false` — the stream's only termination is consumer/Clock.
    onFalse: () =>
      Stream.forever(
        Bool.match(yoyo, {
          onTrue: () => Stream.concat(withDone(legFor(0), false), withDone(legFor(1), false)),
          onFalse: () => withDone(legFor(0), false),
        }),
      ),
    onTrue: () => {
      const runs = Math.max(0, repeats) + 1
      return inSequence(Arr.makeBy(Math.ceil(runs), (i) => legOfRun(legFor(i), i === runs - 1)))
    },
  }).pipe(Stream.withSpan("wardic.animate", { attributes: spanAttributes }))
}

/** Sugar: animate from a known current value to `to` (e.g. interrupting). */
export const animateFrom = (
  current: number,
  to: number,
  options: AnimateOptions = DEFAULT_ANIMATE,
): Stream.Stream<Frame<number>, never, Clock> => animate(current, to, options)

/** Animate through a sequence of stops, splitting `duration` evenly across legs. */
export const keyframes = (
  stops: ReadonlyArray<number>,
  options: TweenOptions,
): Stream.Stream<Frame<number>, never, Clock> => {
  // One leg per pair of consecutive stops; a single stop (or none) holds still for `duration`.
  return Arr.match(Arr.zip(stops, Arr.drop(stops, 1)), {
    onEmpty: () => {
      const only = Option.getOrElse(Arr.head(stops), () => 0)
      return tween(only, only, options)
    },
    onNonEmpty: (pairs) => {
      const legOptions = { ...options, duration: options.duration / pairs.length }
      const last = pairs.length - 1
      return inSequence(Arr.map(pairs, ([from, to], i) => legOfRun(tween(from, to, legOptions), i === last)))
    },
  }).pipe(
    Stream.withSpan("wardic.keyframes", { attributes: { stops: stops.length, duration: options.duration } }),
  )
}
