import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as Spans from "@wardic/core/Spans"

/**
 * The `ReducedMotion` module (ADR-0029): the policy a binding applies when a run starts, and the
 * snap it runs a positional key as. At 1/16 s per tick, exact in binary, as `combinators.test.ts`.
 */
const DT = 1 / 16

/** `ticks` ticks of `DT`. */
const ticksOf = (ticks: number): ReadonlyArray<number> => Array.from({ length: ticks }, () => DT)

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

/** `machine` through `Machine.toStream` on a pushable Clock fed `dts`: its Frames. */
const onTheStream = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, dts: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const fiber = yield* Stream.runCollect(Machine.toStream(machine).pipe(Stream.take(dts.length))).pipe(
      Effect.provide(clock.layer),
      Effect.forkChild({ startImmediately: true }),
    )
    for (const dt of dts) yield* clock.advance(dt)
    return Array.from(yield* Fiber.join(fiber))
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

/** Both drivers give `expected` over `dts`. */
const bothDrivers = <F extends Frame.Frame<unknown>>(
  machine: Machine.Machine<F>,
  expected: ReadonlyArray<F>,
  dts: ReadonlyArray<number>,
) =>
  Effect.gen(function* () {
    expect(yield* onTheStream(machine, dts), "Machine.toStream").toEqual(expected)
    expect((yield* onTheLoop(machine, dts)).frames, "Machine.run").toEqual(expected)
  })

/** `machine`'s last Frame, stepped at `DT` until it settles. */
const lastOf = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>): F => {
  const step = machine.start()
  let frame = step(DT)
  while (!frame.done) frame = step(DT)
  return frame
}

describe("the policy", () => {
  it("applies: `user` follows the preference, `always` and `never` don't read it", () => {
    expect(ReducedMotion.applies("user", true)).toBe(true)
    expect(ReducedMotion.applies("user", false)).toBe(false)
    expect(ReducedMotion.applies("always", false)).toBe(true)
    expect(ReducedMotion.applies("always", true)).toBe(true)
    expect(ReducedMotion.applies("never", true)).toBe(false)
    expect(ReducedMotion.applies("never", false)).toBe(false)
  })

  it("isTransform: Wardic's transform keys, positional in every Environment (ADR-0036)", () => {
    for (const key of ["x", "y", "z", "translateX", "translateY", "translateZ", "scale", "scaleX", "scaleY"]) {
      expect(ReducedMotion.isTransform(key), key).toBe(true)
    }
    for (const key of ["rotate", "rotateX", "rotateY", "rotateZ", "skewX", "skewY"]) {
      expect(ReducedMotion.isTransform(key), key).toBe(true)
    }
    // The box's position and size are an Environment's to name (the DOM's: @wardic/dom's PositionalKeysDomLive).
    for (const key of ["width", "height", "top", "left", "right", "bottom", "opacity", "background-color", "constructor", "toString"]) {
      expect(ReducedMotion.isTransform(key), key).toBe(false)
    }
  })

  it.effect("transformsOnly: the Positional keys core and the Test Environment provide are the transforms", () =>
    Effect.gen(function* () {
      const keys = yield* ReducedMotion.PositionalKeys
      expect(keys.isPositional("x")).toBe(true)
      expect(keys.isPositional("width")).toBe(false)
    }).pipe(Effect.provide(ReducedMotion.transformsOnly)),
  )

  it("split: by the Environment's Positional keys, numbers and strings, apart from the rest", () => {
    const values = { x: 10, width: "200px", opacity: 1, "background-color": "#ffffff" }
    const transforms = ReducedMotion.split(values, { isPositional: ReducedMotion.isTransform })
    expect(transforms.positional).toEqual({ x: 10 })
    expect(transforms.rest).toEqual({ width: "200px", opacity: 1, "background-color": "#ffffff" })
    // An Environment that names `width` too.
    const box = ReducedMotion.split(values, { isPositional: (key) => ReducedMotion.isTransform(key) || key === "width" })
    expect(box.positional).toEqual({ x: 10, width: "200px" })
    expect(box.rest).toEqual({ opacity: 1, "background-color": "#ffffff" })
  })
})

describe("endOf: where `Machine.animate` ends", () => {
  const cases: ReadonlyArray<Machine.Modifiers> = [
    {},
    { reverse: true },
    { repeat: 1 },
    { repeat: 1, repeatType: "reverse" },
    { repeat: 1, repeatType: "mirror" },
    { repeat: 1, repeatType: "loop" },
    { repeat: 2, repeatType: "reverse" },
    { repeat: 3, repeatType: "mirror" },
    { repeat: 1, repeatType: "reverse", reverse: true },
    { repeat: 2, repeatType: "mirror", reverse: true },
    { repeat: 1, repeatType: "reverse", repeatDelay: 0.125 },
  ]

  it.each(cases)("%o: the run's own last Frame", (modifiers) => {
    const machine = Machine.animate(0, 16, { duration: 0.25, ...modifiers })
    expect(ReducedMotion.endOf(0, 16, modifiers)).toBe(lastOf(machine).value)
  })

  it("a run that repeats forever lands where its first run does (Motion's last keyframe)", () => {
    expect(ReducedMotion.endOf(0, 16, { repeat: Number.POSITIVE_INFINITY })).toBe(16)
    expect(ReducedMotion.endOf(0, 16, { repeat: Number.POSITIVE_INFINITY, repeatType: "reverse" })).toBe(16)
    expect(ReducedMotion.endOf(0, 16, { repeat: Number.POSITIVE_INFINITY, repeatType: "mirror", reverse: true })).toBe(0)
  })
})

describe("snap, through both drivers", () => {
  it.effect("with no delay, it settles at `to` on its first tick", () =>
    bothDrivers(ReducedMotion.snap(0, 16), [{ value: 16, done: true }], ticksOf(4)))

  it.effect("with a delay, it holds `from`, then lands on the tick a Machine.delay as long starts its run", () =>
    Effect.gen(function* () {
      const held = { value: 0, done: false }
      yield* bothDrivers(ReducedMotion.snap(0, 16, { delay: 0.25 }), [held, held, held, { value: 16, done: true }], ticksOf(8))
      // The same delay before a tween: held 3 ticks, its run starts at 0 on the 4th, and moves on the 5th.
      const tween = Machine.tween(0, 16, { duration: 0.25 }).pipe(Machine.delay(0.25))
      expect((yield* onTheLoop(tween, ticksOf(5))).frames.map((frame) => frame.value)).toEqual([0, 0, 0, 0, 4])
    }))

  it.effect("the held time counts each tick at most MAX_DT, as Machine.delay's does", () =>
    bothDrivers(
      ReducedMotion.snap(0, 16, { delay: 0.75 }),
      [{ value: 0, done: false }, { value: 16, done: true }],
      [2, 2, 2],
    ))

  it.effect("snaps a value map, and runs under its own span with its delay", () =>
    Effect.gen(function* () {
      const machine = ReducedMotion.snap({ x: 0, width: "10px" }, { x: 40, width: "200px" }, { delay: DT })
      const { frames, spans } = yield* onTheLoop(machine, ticksOf(3))
      expect(frames).toEqual([{ value: { x: 40, width: "200px" }, done: true }])
      const span = spans.find((s) => s.name === "wardic.reducedMotion.snap")
      expect(span?.attributes.get("delay")).toBe(DT)
    }))
})
