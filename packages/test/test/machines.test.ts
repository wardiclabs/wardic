import {
  Clock,
  easeInOutCubic,
  type Frame,
  FrameLoopLive,
  InterpolatorRegistry,
  InterpolatorRegistryLive,
  type Values,
} from "@wardic/core"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"

/**
 * The `Machine` module's Primitives (ADR-0027, ADR-0028):
 * - **the composites against an oracle:** `animate`, `keyframes`, `animateValues` and
 *   `springBlend` through `Machine.toStream`, against their Streams as they were written before
 *   #94, from the leaves' `toStream` with `Stream.concat`, `Stream.forever` and `Stream.map`, so
 *   the combinators' seams are pinned against `Stream.concat`'s and `Stream.forever`'s. The
 *   oracle's hold is `Machine.delay`'s (held Frames, then the time left over), written with
 *   Stream ops, so they compare exactly (ADR-0028, decision 9);
 * - **driver parity:** every constructor through `Machine.toStream` against `Machine.run` on the
 *   Frame loop, Frame for Frame.
 *
 * The dts are uneven on purpose: 60, 30 and 120 Hz frames, a repeated timestamp (0), a 0.25 s
 * stall, and a 0.6 s one above `MAX_DT`, which every constructor clamps (#78).
 */
const DTS: ReadonlyArray<number> = [
  1 / 60,
  1 / 30,
  1 / 120,
  0,
  1 / 60,
  0.25,
  0.6,
  1 / 60,
  ...Array.from({ length: 140 }, (_, i) => Bool.match(i % 3 === 0, { onTrue: () => 1 / 30, onFalse: () => 1 / 60 })),
]

/** Run `a` and `b` side by side on one pushable Clock for `DTS`, and collect each one's Frames. */
const sideBySide = <A, B>(a: Stream.Stream<A, never, any>, b: Stream.Stream<B, never, any>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const layer = Layer.merge(clock.layer, InterpolatorRegistryLive)
    const collect = <X>(stream: Stream.Stream<X, never, any>) =>
      Stream.runCollect(stream.pipe(Stream.take(DTS.length))).pipe(
        Effect.provide(layer),
        Effect.forkChild({ startImmediately: true }),
      )
    const fa = yield* collect(a)
    const fb = yield* collect(b)
    for (const dt of DTS) yield* clock.advance(dt)
    const xs = yield* Fiber.join(fa)
    const ys = yield* Fiber.join(fb)
    return [Array.from(xs), Array.from(ys)] as const
  })

/** The oracle's Frames and the machine's are equal, and there are enough of them to mean it. */
const expectSame = <A>(expected: ReadonlyArray<A>, actual: ReadonlyArray<A>, atLeast: number) => {
  expect(actual).toEqual(expected)
  expect(expected.length).toBeGreaterThanOrEqual(atLeast)
}

const settledLast = (frames: ReadonlyArray<Frame<unknown>>) => frames.at(-1)?.done

// --- The oracle: the composites' Streams as they were before #94 ---------------------------------

/** `frame`, re-stamped `done: false`: a seam's re-stamp. */
const unsettled = <F extends Frame<unknown>>(frame: F): F => ({ ...frame, done: false })

/** A segment that isn't a run's last: its settled Frame re-stamped, so the run settles once. */
const restamped = <F extends Frame<unknown>>(segment: Stream.Stream<F, never, Clock>) =>
  segment.pipe(
    Stream.map((frame) => {
      if (frame.done) return unsettled(frame)
      return frame
    }),
  )

/** Segments one after another, each but the last re-stamped: `Stream.concat`'s seam. */
const inSequence = <F extends Frame<unknown>>(segments: ReadonlyArray<Stream.Stream<F, never, Clock>>) =>
  segments
    .map((segment, i) => {
      if (i === segments.length - 1) return segment
      return restamped(segment)
    })
    .reduce((out, segment) => Stream.concat(out, segment))

/** The Frame a machine starts at: its step at 0, as `Machine.delay` holds it. */
const firstFrame = <F extends Frame<unknown>>(machine: Machine.Machine<F>): F => machine.start()(0)

/**
 * `inner` after a hold of `seconds`, as `Machine.delay` holds: `held` on each tick until the
 * held time (each dt clamped at `MAX_DT`, as `Machine.delay` counts it) reaches
 * `seconds`, then `inner` on a Clock whose first subscription's first tick is the time left
 * over. A later segment of `inner` subscribes again, and starts on the next tick.
 */
const heldFor = <F>(seconds: number, held: F, inner: Stream.Stream<F, never, Clock>): Stream.Stream<F, never, Clock> => {
  if (seconds === 0) return inner
  return Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock
      let elapsed = 0
      const hold = clock.ticks.pipe(
        Stream.map((dt) => (elapsed += Math.min(dt, Machine.MAX_DT))),
        Stream.takeWhile((time) => time < seconds),
        Stream.map(() => held),
      )
      let leftover = true
      const ticks = Stream.suspend(() => {
        if (!leftover) return clock.ticks
        leftover = false
        return Stream.concat(Stream.make(elapsed - seconds), clock.ticks)
      })
      const after = inner.pipe(Stream.provideService(Clock, { ...clock, ticks }))
      return Stream.concat(hold, after)
    }),
  )
}

/**
 * `animate`'s Stream before #94: tweens with no delay, `reverse`'s endpoints swapped, `yoyo`'s odd
 * segments backwards, `repeat`'s runs in sequence, or for an infinite `repeat` the first, then
 * `Stream.forever` over the rest; then the hold.
 */
const animateOracle = (from: number, to: number, options: Machine.AnimateOptions) => {
  const repeats = options.repeat ?? 0
  const yoyo = options.yoyo === true
  let [a, b] = [from, to]
  if (options.reverse === true) [a, b] = [to, from]
  const segment: Machine.TweenOptions = { ...options, delay: 0 }
  const tweenFor = (i: number) => {
    if (yoyo && i % 2 === 1) return Machine.tween(b, a, segment)
    return Machine.tween(a, b, segment)
  }
  const segmentFor = (i: number) => Machine.toStream(tweenFor(i))
  const run = () => {
    if (Number.isFinite(repeats)) {
      return inSequence(Array.from({ length: Math.ceil(Math.max(0, repeats) + 1) }, (_, i) => segmentFor(i)))
    }
    const rest = [segmentFor(1)]
    if (yoyo) rest.push(segmentFor(2))
    return Stream.concat(restamped(segmentFor(0)), Stream.forever(rest.map(restamped).reduce((x, y) => Stream.concat(x, y))))
  }
  return heldFor(options.delay ?? 0, firstFrame(tweenFor(0)), run())
}

/** `keyframes`' Stream before #94: one tween per pair of stops, `duration` split evenly, then the hold. */
const keyframesOracle = (stops: ReadonlyArray<number>, options: Machine.TweenOptions) => {
  const pairs = stops.slice(1).map((to, i) => [stops[i]!, to] as const)
  const duration = options.duration / Math.max(1, pairs.length)
  const segment: Machine.TweenOptions = { ...options, duration, delay: 0 }
  const tweens = pairs.map(([a, b]) => Machine.tween(a, b, segment))
  if (tweens.length === 0) tweens.push(Machine.tween(stops[0] ?? 0, stops[0] ?? 0, segment))
  return heldFor(options.delay ?? 0, firstFrame(tweens[0]!), inSequence(tweens.map(Machine.toStream)))
}

/**
 * Each key's blend from `from` to `to`, resolved through the registry as `animateValues` and
 * `springBlend` resolve it (ADR-0024): a `display` or `visibility` key turning `none` or `hidden`
 * holds its `from` until the last Frame.
 */
const blenderOf = (from: Values, to: Values) =>
  Effect.gen(function* () {
    const registry = yield* InterpolatorRegistry
    const keys: Array<readonly [string, (t: number, done: boolean) => number | string]> = []
    for (const [key, b] of Object.entries(to)) {
      const a = from[key] ?? b
      const invisible = (value: number | string) => ["none", "hidden"].includes(String(value).trim())
      if (["display", "visibility"].includes(key) && invisible(b) && !invisible(a)) {
        keys.push([
          key,
          (_t, done) => {
            if (done) return b
            return a
          },
        ])
        continue
      }
      const blend = yield* registry.resolve(a, b)
      keys.push([key, (t) => blend(t)])
    }
    return (t: number, done: boolean): Frame<Values> => ({
      value: Object.fromEntries(keys.map(([key, blend]) => [key, blend(t, done)])),
      done,
    })
  })

describe("the composites against their Streams before #94", () => {
  const animateCases = [
    ["one segment", { duration: 0.3 }],
    ["repeat 2, a delay held once (#77)", { duration: 0.3, repeat: 2, delay: 0.05 }],
    ["repeat 3, yoyo, reverse, an easing", { duration: 0.25, repeat: 3, yoyo: true, reverse: true, easing: easeInOutCubic }],
    ["repeat Infinity", { duration: 0.2, repeat: Infinity }],
    ["repeat Infinity, yoyo", { duration: 0.2, repeat: Infinity, yoyo: true }],
    ["repeat Infinity, yoyo, a delay held once (#77)", { duration: 0.2, repeat: Infinity, yoyo: true, delay: 0.05 }],
    ["a fractional repeat, which settles on its last segment", { duration: 0.2, repeat: 1.5, yoyo: true }],
    ["a delay of 0.3, past the 0.25 s stall", { duration: 0.4, delay: 0.3 }],
  ] as const
  for (const [name, options] of animateCases) {
    it.effect(`animate: ${name}`, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(animateOracle(-5, 20, options), Machine.toStream(Machine.animate(-5, 20, options)))
        expectSame(s, m, 5)
      }))
  }

  const keyframesCases = [
    ["four stops, a delay held once (#77)", [0, 10, 5, 20], { duration: 0.6, delay: 0.05 }],
    ["one stop", [3], { duration: 0.2 }],
    ["no stops", [], { duration: 0.2 }],
  ] as const
  for (const [name, stops, options] of keyframesCases) {
    it.effect(`keyframes: ${name}`, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(keyframesOracle(stops, options), Machine.toStream(Machine.keyframes(stops, options)))
        expectSame(s, m, 5)
        expect(settledLast(s)).toBe(true)
      }))
  }

  const FROM = { x: 0, "background-color": "#102030", width: "10px", "pointer-events": "auto", visibility: "visible" }
  const TO = { x: 40, "background-color": "#ffffff", width: "200px", "pointer-events": "none", visibility: "hidden" }

  it.effect("animateValues: strings, a Discrete pair and visibility, repeat 1 with yoyo and a delay", () =>
    Effect.gen(function* () {
      const options = { duration: 0.4, repeat: 1, yoyo: true, delay: 0.05, easing: easeInOutCubic }
      const blend = yield* blenderOf(FROM, TO).pipe(Effect.provide(InterpolatorRegistryLive))
      const machine = yield* Machine.animateValues(FROM, TO, options).pipe(Effect.provide(InterpolatorRegistryLive))
      const oracle = animateOracle(0, 1, options).pipe(Stream.map((progress) => blend(progress.value, progress.done)))
      const [s, m] = yield* sideBySide(oracle, Machine.toStream(machine))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))

  it.effect("springBlend: strings, a Discrete pair and visibility, with a delay", () =>
    Effect.gen(function* () {
      const options = { stiffness: 220, damping: 14, delay: 0.05 }
      const blend = yield* blenderOf(FROM, TO).pipe(Effect.provide(InterpolatorRegistryLive))
      const machine = yield* Machine.springBlend(FROM, TO, options).pipe(Effect.provide(InterpolatorRegistryLive))
      const oracle = Machine.toStream(Machine.springValues({ progress: 100 }, options, { progress: 0 }, { progress: 0 })).pipe(
        Stream.map((frame) => blend(frame.value.progress! / 100, frame.done)),
      )
      const [s, m] = yield* sideBySide(oracle, Machine.toStream(machine))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))
})

/**
 * A machine through both drivers on one pushable Clock: `Machine.toStream`, and `Machine.run` on
 * the Frame loop. Each collects up to `DTS.length` Frames; a run that never settles is
 * interrupted at the end. `build` is called once per driver, so a machine that closes over state
 * of its own (a moving target) gives each driver the same.
 */
const bothDrivers = <F extends Frame<unknown>>(build: () => Effect.Effect<Machine.Machine<F>, never, InterpolatorRegistry>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const layer = FrameLoopLive.pipe(Layer.provideMerge(Layer.merge(clock.layer, InterpolatorRegistryLive)))
    return yield* Effect.gen(function* () {
      const viaStream = yield* Stream.runCollect(Machine.toStream(yield* build()).pipe(Stream.take(DTS.length))).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      const viaLoop: Array<F> = []
      const run = yield* (yield* build()).pipe(
        Machine.run((frame) => {
          if (viaLoop.length < DTS.length) viaLoop.push(frame)
          return undefined
        }),
        Effect.forkChild({ startImmediately: true }),
      )
      for (const dt of DTS) yield* clock.advance(dt)
      const fromStream = Array.from(yield* Fiber.join(viaStream))
      yield* Fiber.interrupt(run)
      return [fromStream, viaLoop] as const
    }).pipe(Effect.provide(layer))
  })

describe("every constructor through both drivers", () => {
  const OPTIONS = { duration: 0.3, repeat: 2, yoyo: true, delay: 0.05, easing: easeInOutCubic }
  const FROM = { x: 0, "background-color": "#102030", width: "10px", "pointer-events": "auto", visibility: "visible" }
  const TO = { x: 40, "background-color": "#ffffff", width: "200px", "pointer-events": "none", visibility: "hidden" }
  const cases: ReadonlyArray<
    readonly [string, () => Effect.Effect<Machine.Machine<Frame<unknown>>, never, InterpolatorRegistry>]
  > = [
    ["tween, with an easing and a delay", () => Effect.succeed(Machine.tween(0, 10, OPTIONS))],
    ["spring", () => Effect.succeed(Machine.spring(100, { stiffness: 300, damping: 12, from: -20, velocity: 40 }))],
    [
      "chase, following a moving target",
      () => {
        let target = 0
        return Effect.succeed(Machine.chase(() => (target += 0.5)))
      },
    ],
    ["decay", () => Effect.succeed(Machine.decay(0, 500, { friction: 4 }))],
    ["decayVec", () => Effect.succeed(Machine.decayVec({ x: 0, y: 5 }, { x: 300, y: -200 }, {}))],
    [
      "springValues, from a velocity",
      () => Effect.succeed(Machine.springValues({ x: 0, y: 10 }, { stiffness: 200 }, { x: 100, y: -20 }, { x: 50 })),
    ],
    ["animate, repeat 2, yoyo, a delay", () => Effect.succeed(Machine.animate(-5, 20, OPTIONS))],
    ["animate, repeat Infinity", () => Effect.succeed(Machine.animate(-5, 20, { duration: 0.2, repeat: Infinity }))],
    ["animate, a fractional repeat", () => Effect.succeed(Machine.animate(-5, 20, { duration: 0.2, repeat: 1.5, yoyo: true }))],
    ["keyframes", () => Effect.succeed(Machine.keyframes([0, 10, 5, 20], { duration: 0.6, delay: 0.05 }))],
    ["animateValues", () => Machine.animateValues(FROM, TO, OPTIONS)],
    ["springBlend", () => Machine.springBlend(FROM, TO, { delay: 0.05 })],
  ]
  for (const [name, build] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* bothDrivers(build)
        expectSame(s, m, 5)
      }))
  }
})

describe("every combinator through both drivers", () => {
  const tween = (from: number, to: number) => Machine.tween(from, to, { duration: 0.2, easing: easeInOutCubic })
  const cases: ReadonlyArray<readonly [string, () => Effect.Effect<Machine.Machine<Frame<unknown>>>]> = [
    ["map", () => Effect.succeed(tween(0, 10).pipe(Machine.map((frame) => ({ value: frame.value * 3, done: frame.done }))))],
    ["concat", () => Effect.succeed(tween(0, 10).pipe(Machine.concat(Machine.spring(-10, { stiffness: 300 }))))],
    ["concatAll", () => Effect.succeed(Machine.concatAll([tween(0, 10), tween(10, -4), Machine.decay(-4, 80, {})]))],
    ["forever", () => Effect.succeed(Machine.forever(Machine.concatAll([tween(0, 10), tween(10, 0)])))],
    ["delay, around a spring", () => Effect.succeed(Machine.spring(100).pipe(Machine.delay(0.3)))],
    ["clampDt", () => Effect.succeed(tween(0, 10).pipe(Machine.clampDt(0.02)))],
    ["withSpan", () => Effect.succeed(tween(0, 10).pipe(Machine.withSpan("app.tween", { attributes: { a: 1 } })))],
  ]
  for (const [name, build] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* bothDrivers(build)
        expectSame(s, m, 5)
      }))
  }
})

/**
 * `Machine.delay` against the steppers' own `delay` (ADR-0028, decision 9): the hold, then the
 * time left over to an undelayed step, where the stepper subtracts the delay from its elapsed time
 * on every step. On these dts the sums round differently, so a Frame after the hold can differ in
 * its last bit, and only there: every `done` and every Frame count are the same.
 */
describe("Machine.delay against the steppers' delay", () => {
  const cases: ReadonlyArray<readonly [string, Machine.Machine<Frame<number>>, Machine.Machine<Frame<number>>]> = [
    ...[0.05, 0.1, 0.3].map((delay) =>
      [
        `tween −5 → 20, 2 s, delay ${delay}`,
        Machine.tween(-5, 20, { duration: 2, delay }),
        Machine.tween(-5, 20, { duration: 2 }).pipe(Machine.delay(delay)),
      ] as const),
    [
      "tween 0 → 1, 0.2 s, delay 0.05",
      Machine.tween(0, 1, { duration: 0.2, delay: 0.05 }),
      Machine.tween(0, 1, { duration: 0.2 }).pipe(Machine.delay(0.05)),
    ],
    ...[0.05, 0.3].map((delay) =>
      [
        `spring 0 → 100, delay ${delay}`,
        Machine.spring(100, { delay }),
        Machine.spring(100).pipe(Machine.delay(delay)),
      ] as const),
  ]
  for (const [name, stepper, held] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(Machine.toStream(stepper), Machine.toStream(held))
        expect(m.length).toBe(s.length)
        expect(s.length).toBeGreaterThanOrEqual(5)
        expect(m.map((frame) => frame.done)).toEqual(s.map((frame) => frame.done))
        for (const [i, frame] of m.entries()) expect(Math.abs(frame.value - s[i]!.value)).toBeLessThan(1e-12)
      }))
  }
})
