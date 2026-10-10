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
      attributes: { from: 0, to: 16, repeat: 0, repeatDelay: 0, yoyo: false, reverse: false },
    })
    expect(animate.settles).toBe(true)
  })
})
