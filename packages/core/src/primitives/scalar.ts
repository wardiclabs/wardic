import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { AnimateOptions, DecayOptions, SpringOptions, TweenOptions } from "../options.ts"
import { Clock } from "../services/Clock.ts"
import { chaseCore } from "./chase.ts"
import { type Frame, MAX_DT, type PhysicsFrame } from "./frame.ts"
import {
  decayStep,
  initDecay,
  initTween,
  type PhysicsStepResult,
  type StepResult,
  tweenStep,
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
 * it is the hot path.
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
          const clampedDt = dt > MAX_DT ? MAX_DT : dt
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
): Stream.Stream<Frame<number>, never, Clock> =>
  fromClock(
    "wardic.tween",
    { from, to, duration: options.duration },
    initTween,
    (state, dt) => tweenStep(state, dt, from, to, options),
    definiteFrame,
  )

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
  const attributes = {
    target,
    stiffness: options.stiffness ?? 170,
    damping: options.damping ?? 26,
  }
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
): Stream.Stream<PhysicsFrame, never, Clock> =>
  fromClock(
    "wardic.decay",
    { initial, velocity, friction: options.friction ?? 3 },
    () => initDecay(initial, velocity),
    (state, dt) => decayStep(state, dt, options),
    physicsFrame,
  )

const DEFAULT_ANIMATE: AnimateOptions = { duration: 0.3 }

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
  const [a, b] = options.reverse ? [to, from] : [from, to]
  const repeats = options.repeat ?? 0
  const yoyo = options.yoyo === true
  const finite = Number.isFinite(repeats)

  const legFor = (i: number): Stream.Stream<Frame<number>, never, Clock> => {
    const reverseLeg = yoyo && i % 2 === 1
    return tween(reverseLeg ? b : a, reverseLeg ? a : b, options)
  }

  const spanAttributes = {
    from,
    to,
    repeat: repeats,
    yoyo,
    reverse: options.reverse ?? false,
  }

  if (!finite) {
    // Infinite repeat: forever over a one- or two-leg cycle. Every emitted frame
    // carries `done: false` — the stream's only termination is consumer/Clock.
    const cycle = yoyo
      ? Stream.concat(withDone(legFor(0), false), withDone(legFor(1), false))
      : withDone(legFor(0), false)
    return Stream.forever(cycle).pipe(Stream.withSpan("wardic.animate", { attributes: spanAttributes }))
  }

  const runs = Math.max(0, repeats) + 1
  let out = runs === 1 ? legFor(0) : withDone(legFor(0), false)
  for (let i = 1; i < runs; i++) {
    const leg = legFor(i)
    out = Stream.concat(out, i === runs - 1 ? leg : withDone(leg, false))
  }
  return out.pipe(Stream.withSpan("wardic.animate", { attributes: spanAttributes }))
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
  const build = (): Stream.Stream<Frame<number>, never, Clock> => {
    if (stops.length <= 1) {
      const only = stops[0] ?? 0
      return tween(only, only, options)
    }
    const legDuration = options.duration / (stops.length - 1)
    const lastIndex = stops.length - 2
    let out: Stream.Stream<Frame<number>, never, Clock> =
      lastIndex === 0
        ? tween(stops[0]!, stops[1]!, { ...options, duration: legDuration })
        : withDone(tween(stops[0]!, stops[1]!, { ...options, duration: legDuration }), false)
    for (let i = 1; i <= lastIndex; i++) {
      const leg = tween(stops[i]!, stops[i + 1]!, { ...options, duration: legDuration })
      out = Stream.concat(out, i === lastIndex ? leg : withDone(leg, false))
    }
    return out
  }
  return build().pipe(
    Stream.withSpan("wardic.keyframes", { attributes: { stops: stops.length, duration: options.duration } }),
  )
}
