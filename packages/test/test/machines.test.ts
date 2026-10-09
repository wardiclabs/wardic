import {
  type Machine,
  animate,
  animateMachine,
  animateValues,
  animateValuesMachine,
  chase,
  chaseMachine,
  decay,
  decayMachine,
  decayVec,
  decayVecMachine,
  easeInOutCubic,
  type Frame,
  FrameLoop,
  FrameLoopLive,
  InterpolatorRegistryLive,
  keyframes,
  keyframesMachine,
  spring,
  springBlend,
  springBlendMachine,
  springMachine,
  springValues,
  springValuesMachine,
  toStream,
  tween,
  tweenMachine,
} from "@wardic/core"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"

/**
 * Each Primitive's machine (ADR-0027) against its `Stream`, on one live (pushable) Clock: the
 * same Frames, tick for tick. The leaves' Streams run their machines; the composites' Streams
 * still compose the leaves' Streams (`Stream.concat`, `Stream.forever`, `Stream.map`), so these
 * pin the composite machines' seams against them.
 *
 * The last block runs each machine on the Frame loop instead (`FrameLoop.run`), against the same
 * `Stream`: the two drivers of ADR-0027, Frame for Frame.
 *
 * The dts are uneven on purpose: 60, 30 and 120 Hz frames, a repeated timestamp (0), a 0.25 s
 * stall, and a 0.6 s one above `MAX_DT`, which every leaf clamps (#78).
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

/** The Stream's Frames and the machine's are equal, and there are enough of them to mean it. */
const expectSame = <A>(streamFrames: ReadonlyArray<A>, machineFrames: ReadonlyArray<A>, atLeast: number) => {
  expect(machineFrames).toEqual(streamFrames)
  expect(streamFrames.length).toBeGreaterThanOrEqual(atLeast)
}

const settledLast = (frames: ReadonlyArray<Frame<unknown>>) => frames.at(-1)?.done

/**
 * ADR-0027's one difference between the drivers (*Implementation*), declared with #74: a
 * fractional `repeat` (1.5) plays ceil(2.5) = 3 segments. The Stream re-stamps the last one's
 * settled Frame `done: false` and ends with no settled Frame; the machine settles on it. Every
 * Frame before it is the same.
 */
const settlesOnItsLastSegment = (s: ReadonlyArray<Frame<number>>, m: ReadonlyArray<Frame<number>>) => {
  expect(s.length).toBeGreaterThanOrEqual(10)
  expect(s.some((frame) => frame.done)).toBe(false)
  expect(m).toEqual([...s.slice(0, -1), { ...s.at(-1)!, done: true }])
}

describe("leaf machines: the Stream runs the machine", () => {
  it.effect("tween, with an easing and a delay", () =>
    Effect.gen(function* () {
      const options = { duration: 0.5, easing: easeInOutCubic, delay: 0.1 }
      const [s, m] = yield* sideBySide(tween(0, 10, options), toStream(tweenMachine(0, 10, options)))
      expectSame(s, m, 5)
      expect(settledLast(s)).toBe(true)
    }))

  it.effect("spring", () =>
    Effect.gen(function* () {
      const options = { stiffness: 300, damping: 12, from: -20, velocity: 40 }
      const [s, m] = yield* sideBySide(spring(100, options), toStream(springMachine(100, options)))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))

  it.effect("chase, following a moving target, never ends on its own", () =>
    Effect.gen(function* () {
      let target = 0
      const getTarget = () => (target += 0.5)
      // Each driver reads its own target, moving the same way.
      let other = 0
      const getOther = () => (other += 0.5)
      const [s, m] = yield* sideBySide(chase(getTarget), toStream(chaseMachine(getOther)))
      expectSame(s, m, DTS.length)
    }))

  it.effect("decay", () =>
    Effect.gen(function* () {
      const [s, m] = yield* sideBySide(decay(0, 500, { friction: 4 }), toStream(decayMachine(0, 500, { friction: 4 })))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))

  it.effect("decayVec", () =>
    Effect.gen(function* () {
      const [s, m] = yield* sideBySide(
        decayVec({ x: 0, y: 5 }, { x: 300, y: -200 }, {}),
        toStream(decayVecMachine({ x: 0, y: 5 }, { x: 300, y: -200 }, {})).pipe(Stream.map((frame) => frame.value)),
      )
      expectSame(s, m, 10)
    }))

  it.effect("springValues, from a velocity", () =>
    Effect.gen(function* () {
      const args = [{ x: 0, y: 10, scale: 1 }, { stiffness: 200 }, { x: 100, y: -20, scale: 1.4 }, { x: 50 }] as const
      const [s, m] = yield* sideBySide(springValues(...args), toStream(springValuesMachine(...args)))
      // The 0.6 s dt steps 0.5 s (#78), in both.
      expectSame(s, m, 5)
      expect(settledLast(s)).toBe(true)
    }))
})

describe("composite machines against the composite Streams", () => {
  const animateCases = [
    ["one segment", { duration: 0.3 }],
    ["repeat 2, a delay held once (#77)", { duration: 0.3, repeat: 2, delay: 0.05 }],
    ["repeat 3, yoyo, reverse, an easing", { duration: 0.25, repeat: 3, yoyo: true, reverse: true, easing: easeInOutCubic }],
    ["repeat Infinity", { duration: 0.2, repeat: Infinity }],
    ["repeat Infinity, yoyo", { duration: 0.2, repeat: Infinity, yoyo: true }],
    ["repeat Infinity, yoyo, a delay held once (#77)", { duration: 0.2, repeat: Infinity, yoyo: true, delay: 0.05 }],
  ] as const
  for (const [name, options] of animateCases) {
    it.effect(`animate: ${name}`, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(animate(-5, 20, options), toStream(animateMachine(-5, 20, options)))
        expectSame(s, m, 5)
      }))
  }

  it.effect("animate: a fractional repeat, where the machine settles on its last segment and the Stream ends with none", () =>
    Effect.gen(function* () {
      const options = { duration: 0.2, repeat: 1.5, yoyo: true }
      const [s, m] = yield* sideBySide(animate(-5, 20, options), toStream(animateMachine(-5, 20, options)))
      settlesOnItsLastSegment(s, m)
    }))

  const keyframesCases = [
    ["four stops, a delay held once (#77)", [0, 10, 5, 20], { duration: 0.6, delay: 0.05 }],
    ["one stop", [3], { duration: 0.2 }],
    ["no stops", [], { duration: 0.2 }],
  ] as const
  for (const [name, stops, options] of keyframesCases) {
    it.effect(`keyframes: ${name}`, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(keyframes(stops, options), toStream(keyframesMachine(stops, options)))
        expectSame(s, m, 5)
        expect(settledLast(s)).toBe(true)
      }))
  }

  const FROM = { x: 0, "background-color": "#102030", width: "10px", "pointer-events": "auto", visibility: "visible" }
  const TO = { x: 40, "background-color": "#ffffff", width: "200px", "pointer-events": "none", visibility: "hidden" }

  it.effect("animateValues: strings, a Discrete pair and visibility, repeat 1 with yoyo", () =>
    Effect.gen(function* () {
      const options = { duration: 0.4, repeat: 1, yoyo: true, easing: easeInOutCubic }
      const machine = yield* animateValuesMachine(FROM, TO, options).pipe(Effect.provide(InterpolatorRegistryLive))
      const [s, m] = yield* sideBySide(animateValues(FROM, TO, options), toStream(machine))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))

  it.effect("springBlend: strings, a Discrete pair and visibility, with a delay", () =>
    Effect.gen(function* () {
      const options = { stiffness: 220, damping: 14, delay: 0.05 }
      const machine = yield* springBlendMachine(FROM, TO, options).pipe(Effect.provide(InterpolatorRegistryLive))
      const [s, m] = yield* sideBySide(springBlend(FROM, TO, options), toStream(machine))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))
})

/**
 * `stream` and `machine` side by side on one pushable Clock, the machine on the Frame loop. Each
 * collects up to `DTS.length` Frames; a run that never settles is interrupted at the end.
 */
const onTheLoop = <A, F extends Frame<unknown>, R>(
  stream: Stream.Stream<A, never, any>,
  machine: Effect.Effect<Machine<F>, never, R>,
) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const layer = FrameLoopLive.pipe(Layer.provideMerge(Layer.merge(clock.layer, InterpolatorRegistryLive)))
    return yield* Effect.gen(function* () {
      const loop = yield* FrameLoop
      const viaStream = yield* Stream.runCollect(stream.pipe(Stream.take(DTS.length))).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      const viaLoop: Array<F> = []
      const run = yield* loop
        .run(yield* machine, (frame) => {
          if (viaLoop.length < DTS.length) viaLoop.push(frame)
          return undefined
        })
        .pipe(Effect.forkChild({ startImmediately: true }))
      for (const dt of DTS) yield* clock.advance(dt)
      const fromStream = Array.from(yield* Fiber.join(viaStream))
      yield* Fiber.interrupt(run)
      return [fromStream, viaLoop] as const
    }).pipe(Effect.provide(layer))
  })

describe("every machine on the Frame loop against its Stream", () => {
  const OPTIONS = { duration: 0.3, repeat: 2, yoyo: true, delay: 0.05, easing: easeInOutCubic }
  const FROM = { x: 0, "background-color": "#102030", width: "10px", "pointer-events": "auto", visibility: "visible" }
  const TO = { x: 40, "background-color": "#ffffff", width: "200px", "pointer-events": "none", visibility: "hidden" }
  let target = 0
  let other = 0
  const cases: ReadonlyArray<readonly [string, Stream.Stream<unknown, never, any>, Effect.Effect<Machine<any>, never, any>]> = [
    ["tween", tween(0, 10, OPTIONS), Effect.succeed(tweenMachine(0, 10, OPTIONS))],
    ["spring", spring(100, { stiffness: 300, damping: 12 }), Effect.succeed(springMachine(100, { stiffness: 300, damping: 12 }))],
    ["chase", chase(() => (target += 0.5)), Effect.succeed(chaseMachine(() => (other += 0.5)))],
    ["decay", decay(0, 500, { friction: 4 }), Effect.succeed(decayMachine(0, 500, { friction: 4 }))],
    ["springValues", springValues({ x: 0, y: 10 }, {}, { x: 100, y: -20 }, { x: 50 }), Effect.succeed(springValuesMachine({ x: 0, y: 10 }, {}, { x: 100, y: -20 }, { x: 50 }))],
    ["animate, repeat 2, yoyo, a delay", animate(-5, 20, OPTIONS), Effect.succeed(animateMachine(-5, 20, OPTIONS))],
    ["animate, repeat Infinity", animate(-5, 20, { duration: 0.2, repeat: Infinity }), Effect.succeed(animateMachine(-5, 20, { duration: 0.2, repeat: Infinity }))],
    ["keyframes", keyframes([0, 10, 5, 20], { duration: 0.6, delay: 0.05 }), Effect.succeed(keyframesMachine([0, 10, 5, 20], { duration: 0.6, delay: 0.05 }))],
    ["animateValues", animateValues(FROM, TO, OPTIONS), animateValuesMachine(FROM, TO, OPTIONS)],
    ["springBlend", springBlend(FROM, TO, { delay: 0.05 }), springBlendMachine(FROM, TO, { delay: 0.05 })],
  ]
  for (const [name, stream, machine] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* onTheLoop(stream, machine)
        expectSame(s, m, 5)
      }))
  }

  it.effect("decayVec", () =>
    Effect.gen(function* () {
      const [s, m] = yield* onTheLoop(
        decayVec({ x: 0, y: 5 }, { x: 300, y: -200 }, {}),
        Effect.succeed(decayVecMachine({ x: 0, y: 5 }, { x: 300, y: -200 }, {})),
      )
      expectSame(s, m.map((frame) => frame.value), 5)
    }))

  // On the loop the run ends at that settled Frame: a run that didn't settle would take a Frame
  // on every tick until the end.
  it.effect("animate, a fractional repeat: the run settles on its last segment, where the Stream ends with none", () =>
    Effect.gen(function* () {
      const options = { duration: 0.2, repeat: 1.5, yoyo: true }
      const [s, m] = yield* onTheLoop(animate(-5, 20, options), Effect.succeed(animateMachine(-5, 20, options)))
      settlesOnItsLastSegment(s, m)
    }))
})
