import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as Spans from "@wardic/core/Spans"

/**
 * The `Machine` module's combinators (ADR-0028, decisions 5 to 7), each through both drivers:
 * `Machine.toStream`, and `Machine.run` on the Frame loop.
 *
 * On a pushable Clock at 1/16 s per tick, exact in binary so no rounding enters the timing (as
 * `delay-once.test.ts`): a 0.25 s tween is 4 ticks, a 0.125 s hold is 2, and 0 → 16 moves 4 per
 * tick, so every Frame is a whole number.
 */
const DT = 1 / 16
const QUARTER = { duration: 0.25 }

/** Frames with these values: settled on the last when `settles`, never otherwise. */
const framesOf = (values: ReadonlyArray<number>, settles: boolean): Array<Frame.Frame<number>> =>
  values.map((value, i) => ({ value, done: settles && i === values.length - 1 }))

/** A recording tracer: every span it makes. */
const makeTracer = () => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  return { spans, tracer }
}

/** `machine` through `Machine.toStream` on a pushable Clock fed `dts`: its Frames, and the spans it opened. */
const onTheStream = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, dts: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const { spans, tracer } = makeTracer()
    const fiber = yield* Stream.runCollect(Machine.toStream(machine).pipe(Stream.take(dts.length))).pipe(
      Effect.provide(Layer.merge(clock.layer, InterpolatorRegistry.layer)),
      Effect.provideService(Tracer.Tracer, tracer),
      // Wardic's spans, the app's to give (#746).
      Effect.provide(Spans.layer),
      Effect.forkChild({ startImmediately: true }),
    )
    for (const dt of dts) yield* clock.advance(dt)
    return { frames: Array.from(yield* Fiber.join(fiber)), spans }
  })

/** `machine` through `Machine.run` on the Frame loop over a pushable Clock fed `dts`: its sink's Frames, and the spans. */
const onTheLoop = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, dts: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const { spans, tracer } = makeTracer()
    return yield* Effect.gen(function* () {
      const frames: Array<F> = []
      const run = yield* machine.pipe(
        Machine.run((frame) => {
          frames.push(frame)
          return undefined
        }),
        Effect.provideService(Tracer.Tracer, tracer),
        // Wardic's spans, the app's to give (#746).
        Effect.provide(Spans.layer),
        Effect.forkChild({ startImmediately: true }),
      )
      for (const dt of dts) yield* clock.advance(dt)
      yield* Fiber.interrupt(run)
      return { frames, spans }
    }).pipe(Effect.provide(FrameLoop.layer.pipe(Layer.provide(clock.layer))))
  })

/** `ticks` ticks of `DT`. */
const ticksOf = (ticks: number): ReadonlyArray<number> => Array.from({ length: ticks }, () => DT)

/** Both drivers give `expected` over `dts`. */
const bothDrivers = <F extends Frame.Frame<unknown>>(
  machine: Machine.Machine<F>,
  expected: ReadonlyArray<F>,
  dts: ReadonlyArray<number> = ticksOf(24),
) =>
  Effect.gen(function* () {
    expect((yield* onTheStream(machine, dts)).frames, "Machine.toStream").toEqual(expected)
    expect((yield* onTheLoop(machine, dts)).frames, "Machine.run").toEqual(expected)
  })

/** A machine whose Frame carries the `dt` it was stepped with: what a combinator hands its inner step. */
const echo = Machine.make<Frame.Frame<number>>({
  settles: false,
  span: { name: "test.echo", attributes: {} },
  start: () => (dt) => ({ value: dt, done: false }),
})

describe("each combinator through both drivers, at 1/16 s ticks", () => {
  it.effect("concat: `that` starts on the tick after `self` settles, whose Frame is re-stamped", () =>
    bothDrivers(
      Machine.tween(0, 16, QUARTER).pipe(Machine.concat(Machine.tween(16, 0, QUARTER))),
      framesOf([4, 8, 12, 16, 12, 8, 4, 0], true),
    ))

  it.effect("concat: a `self` that never settles never reaches `that`, as `Stream.concat` after a chase", () =>
    Effect.gen(function* () {
      const chase = Machine.chase(() => 16)
      const machine = chase.pipe(Machine.concat(Machine.tween(100, 200, QUARTER)))
      expect(machine.settles).toBe(false)
      const alone = (yield* onTheStream(chase, ticksOf(48))).frames
      // The chase lands on 16 and reports rest, and the run goes on: the tween never starts.
      expect(alone.some((frame) => frame.done)).toBe(true)
      yield* bothDrivers(machine, alone, ticksOf(48))
    }))

  it.effect("concatAll: one step through the segments, each seam re-stamped, the last settling", () =>
    bothDrivers(
      Machine.concatAll([Machine.tween(0, 16, QUARTER), Machine.tween(16, 8, QUARTER), Machine.tween(8, 24, QUARTER)]),
      framesOf([4, 8, 12, 16, 14, 12, 10, 8, 12, 16, 20, 24], true),
    ))

  it.effect("forever: restarts on the tick after it settles, every Frame `done: false`", () =>
    Effect.gen(function* () {
      const machine = Machine.forever(Machine.tween(0, 16, QUARTER))
      expect(machine.settles).toBe(false)
      yield* bothDrivers(machine, framesOf([4, 8, 12, 16, 4, 8, 12, 16, 4, 8, 12, 16], false), ticksOf(12))
    }))

  it.effect("delay: the start held for 0.125 s, then the tween from the tick after", () =>
    bothDrivers(Machine.tween(0, 16, QUARTER).pipe(Machine.delay(0.125)), framesOf([0, 0, 4, 8, 12, 16], true)))

  it.effect("delay: each held tick returns the same Frame, and the time left over goes to the first step", () =>
    Effect.gen(function* () {
      // 0.1 s held over 1/16 s ticks: the second tick reaches 0.125, and steps the 0.025 left.
      const machine = echo.pipe(Machine.delay(0.1))
      for (const run of [yield* onTheStream(machine, ticksOf(4)), yield* onTheLoop(machine, ticksOf(4))]) {
        expect(run.frames.map((frame) => frame.value)).toEqual([0, 0.125 - 0.1, DT, DT])
      }
      const held = (yield* onTheLoop(Machine.tween(0, 16, QUARTER).pipe(Machine.delay(0.25)), ticksOf(3))).frames
      expect(held[1]).toBe(held[0])
      expect(held[2]).toBe(held[0])
    }))

  it.effect("delay: a negative delay starts that far in", () =>
    bothDrivers(Machine.tween(0, 16, QUARTER).pipe(Machine.delay(-0.125)), framesOf([12, 16], true)))

  it.effect("holdAfter: the settled value held for 0.125 s, then the settle", () =>
    bothDrivers(Machine.tween(0, 16, QUARTER).pipe(Machine.holdAfter(0.125)), framesOf([4, 8, 12, 16, 16, 16], true)))

  it.effect("holdAfter: one re-stamped Frame on every held tick, then self's own settled Frame", () =>
    Effect.gen(function* () {
      const frames = (yield* onTheLoop(Machine.tween(0, 16, QUARTER).pipe(Machine.holdAfter(0.25)), ticksOf(8))).frames
      expect(frames.map((frame) => frame.done)).toEqual([false, false, false, false, false, false, false, true])
      expect(frames[4]).toBe(frames[3])
      expect(frames[6]).toBe(frames[3])
      expect(frames[7]).not.toBe(frames[3])
    }))

  it.effect("holdAfter: a stall counts at most MAX_DT toward the hold, as a step does", () =>
    bothDrivers(
      Machine.tween(0, 16, QUARTER).pipe(Machine.holdAfter(1)),
      framesOf([4, 8, 12, 16, 16, 16], true),
      [DT, DT, DT, DT, 30, 30, DT],
    ))

  it.effect("holdAfter: then concat's next machine starts on the tick after the hold settles", () =>
    bothDrivers(
      Machine.tween(0, 16, QUARTER).pipe(Machine.holdAfter(0.125), Machine.concat(Machine.tween(16, 0, QUARTER))),
      framesOf([4, 8, 12, 16, 16, 16, 12, 8, 4, 0], true),
    ))

  it.effect("clampDt: a dt above the bound steps the bound", () =>
    bothDrivers(
      echo.pipe(Machine.clampDt(Machine.MAX_DT)),
      framesOf([DT, Machine.MAX_DT, DT], false),
      [DT, 30, DT],
    ))

  it.effect("every constructor clamps its dt at MAX_DT, so one 30 s dt steps 0.5 s (#78)", () =>
    bothDrivers(Machine.tween(0, 16, { duration: 1 }), framesOf([8, 16], true), [30, 30]))

  it.effect("delay: a stall counts at most MAX_DT toward the hold, as a step does", () =>
    bothDrivers(
      Machine.tween(0, 16, QUARTER).pipe(Machine.delay(1)),
      framesOf([0, 0, 4, 8, 12, 16], true),
      [30, 30, DT, DT, DT, DT],
    ))

  it.effect("map: each Frame mapped", () =>
    bothDrivers(
      Machine.tween(0, 16, QUARTER).pipe(Machine.map((frame) => ({ value: frame.value * 2, done: frame.done }))),
      framesOf([8, 16, 24, 32], true),
    ))

  it.effect("withSpan: a run's one span is the given name and attributes, on both drivers", () =>
    Effect.gen(function* () {
      const machine = Machine.tween(0, 16, QUARTER).pipe(Machine.withSpan("app.bounce", { attributes: { height: 16 } }))
      expect(machine.span).toEqual({ name: "app.bounce", attributes: { height: 16 } })
      for (const run of [yield* onTheStream(machine, ticksOf(4)), yield* onTheLoop(machine, ticksOf(4))]) {
        expect(run.frames).toEqual(framesOf([4, 8, 12, 16], true))
        const named = run.spans.filter((span) => span.name.startsWith("app.") || span.name.startsWith("wardic.tween"))
        expect(named.map((span) => span.name)).toEqual(["app.bounce"])
        expect(Object.fromEntries(named[0]!.attributes)).toEqual({ height: 16 })
      }
    }))

  it.effect("withSpan: with no options, a span with no attributes; data-first as well", () =>
    Effect.gen(function* () {
      const tween = Machine.tween(0, 16, QUARTER)
      expect(tween.pipe(Machine.withSpan("app.a")).span).toEqual({ name: "app.a", attributes: {} })
      expect(Machine.withSpan(tween, "app.b", { attributes: { x: 1 } }).span).toEqual({ name: "app.b", attributes: { x: 1 } })
      // The span is replaced, not nested: the tween's own is gone.
      expect(Machine.withSpan(tween, "app.c").span.name).toBe("app.c")
      expect(tween.span.name).toBe("wardic.tween")
    }))
})

describe("startAt: a run started partway through (#48, ADR-0044's Handoff)", () => {
  it.effect("the first tick draws the Frame at `at()`, and later ticks step on from there", () =>
    Effect.gen(function* () {
      for (const driver of [onTheStream, onTheLoop]) {
        // 0.125 s is 7.5 frames of 1/60 s: the sum of the catch-up's steps is 0.125 to the last bits.
        const frames = (yield* driver(Machine.tween(0, 16, QUARTER).pipe(Machine.startAt(() => 0.125)), ticksOf(4))).frames
        expect(frames.map((frame) => frame.done)).toEqual([false, false, true])
        expect(frames.map((frame) => frame.value).map((v, i) => Math.abs(v - [8, 12, 16][i]!) < 1e-9)).toEqual([true, true, true])
      }
    }))

  it.effect("the catch-up steps 0, then 1/60 s at a time, the last step what's left; then each tick's dt", () =>
    Effect.gen(function* () {
      for (const driver of [onTheStream, onTheLoop]) {
        const seen: Array<number> = []
        const recording = Machine.make<Frame.Frame<number>>({
          settles: false,
          span: { name: "test.recording", attributes: {} },
          start: () => (dt) => {
            seen.push(dt)
            return { value: dt, done: false }
          },
        })
        yield* driver(recording.pipe(Machine.startAt(() => 0.04)), ticksOf(2))
        expect(seen.slice(0, 3)).toEqual([0, Machine.CATCH_UP_DT, Machine.CATCH_UP_DT])
        expect(seen[3]).toBeCloseTo(0.04 - 2 * Machine.CATCH_UP_DT, 12)
        expect(seen.slice(4)).toEqual([DT])
      }
    }))

  it.effect("caught up to k / 60, a spring is where 0 and then k steps of 1/60 s put it: the Appear sampler's steps", () =>
    Effect.gen(function* () {
      const spring = Machine.spring(100, { from: 0 })
      const byHand = spring.start()
      byHand(0)
      const sampled: Array<number> = []
      for (let k = 1; k <= 40; k++) sampled.push(byHand(Machine.CATCH_UP_DT).value)
      for (const k of [1, 7, 23, 40]) {
        const frames = (yield* onTheLoop(spring.pipe(Machine.startAt(() => k / 60)), [DT])).frames
        expect(frames[0]!.value, `k = ${k}`).toBe(sampled[k - 1])
      }
    }))

  it.effect("`at` is read once a run, at its first tick", () =>
    Effect.gen(function* () {
      let reads = 0
      const machine = Machine.tween(0, 16, QUARTER).pipe(Machine.startAt(() => {
        reads++
        return 0.0625
      }))
      expect(reads, "not when built").toBe(0)
      yield* onTheLoop(machine, ticksOf(3))
      expect(reads).toBe(1)
      yield* onTheStream(machine, ticksOf(3))
      expect(reads, "once more for a second run").toBe(2)
    }))

  it.effect("settling in the catch-up ends the run on its first tick", () =>
    bothDrivers(Machine.tween(0, 16, QUARTER).pipe(Machine.startAt(() => 1)), framesOf([16], true)))

  it.effect("at 0, the first tick is the step at 0", () =>
    bothDrivers(Machine.tween(0, 16, QUARTER).pipe(Machine.startAt(() => 0)), framesOf([0, 4, 8, 12, 16], true)))

  it.effect("below 0, a start still to come: the step at 0 held that long, then the time left over", () =>
    Effect.gen(function* () {
      // At -0.125 s: the first tick draws the start; the run starts on the third, 0.125 s later.
      yield* bothDrivers(Machine.tween(0, 16, QUARTER).pipe(Machine.startAt(() => -0.125)), framesOf([0, 0, 0, 4, 8, 12, 16], true))
      // At -0.1 s, ticks of 1/16 s: the hold ends 0.025 s into the third tick, which steps that.
      const seen: Array<number> = []
      const recording = Machine.make<Frame.Frame<number>>({
        settles: false,
        span: { name: "test.recording", attributes: {} },
        start: () => (dt) => {
          seen.push(dt)
          return { value: dt, done: false }
        },
      })
      yield* onTheLoop(recording.pipe(Machine.startAt(() => -0.1)), ticksOf(4))
      expect(seen[0]).toBe(0)
      expect(seen[1]).toBeCloseTo(2 * DT - 0.1, 12)
      expect(seen.slice(2)).toEqual([DT])
    }))

  it.effect("a long catch-up isn't clamped at MAX_DT, as a negative delay's one step is", () =>
    Effect.gen(function* () {
      const three = Machine.tween(0, 30, { duration: 3 })
      expect((yield* onTheLoop(three.pipe(Machine.startAt(() => 2)), [DT])).frames[0]!.value).toBeCloseTo(20, 9)
      expect((yield* onTheLoop(three.pipe(Machine.delay(-2)), [DT])).frames[0]!.value).toBeLessThan(20)
    }))

  it("keeps the span and whether it settles; both forms give one type", () => {
    const spring = Machine.spring(100)
    expect(spring.pipe(Machine.startAt(() => 1)).span).toBe(spring.span)
    expect(Machine.startAt(Machine.chase(() => 1), () => 1).settles).toBe(false)
  })
})

describe("defaults add no layer (ADR-0028, decision 7)", () => {
  const tween = Machine.tween(0, 16, QUARTER)
  const chase = Machine.chase(() => 16)

  it("holdAfter(0), a negative hold, and a hold after a machine that never settles are their input", () => {
    expect(tween.pipe(Machine.holdAfter(0))).toBe(tween)
    expect(Machine.holdAfter(tween, -1)).toBe(tween)
    expect(chase.pipe(Machine.holdAfter(0.5))).toBe(chase)
  })

  it("delay(0) is its input", () => {
    expect(tween.pipe(Machine.delay(0))).toBe(tween)
    expect(Machine.delay(tween, 0)).toBe(tween)
  })

  it("a one-segment concatAll is its segment", () => {
    expect(Machine.concatAll([tween])).toBe(tween)
  })

  it("a sequence ends at a segment that never settles", () => {
    expect(chase.pipe(Machine.concat(tween))).toBe(chase)
    expect(Machine.concatAll([chase, tween, tween])).toBe(chase)
    expect(Machine.forever(chase)).toBe(chase)
  })

  it("an animate with one segment and no delay is one tween, named wardic.animate", () => {
    const animate = Machine.animate(0, 16, QUARTER)
    expect(animate.span).toEqual({
      name: "wardic.animate",
      attributes: { from: 0, to: 16, repeat: 0, repeatDelay: 0, repeatType: "loop", reverse: false },
    })
    expect(animate.settles).toBe(true)
  })
})
