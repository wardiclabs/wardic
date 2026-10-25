import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { motionRunAt, type RunOptions } from "./motion-oracle.ts"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"

/**
 * `repeatDelay` (#91): each run but the last holds where it ended (a turned run, at its turning
 * point), then the next starts, as Motion's `repeatDelay` does (motion-dom `JSAnimation.tick`).
 * `animate` is one time across every run and gap (#226), so the next run starts the moment the
 * gap ends; an infinite `repeat` holds after every run; `delay` still holds once, before the first.
 *
 * On a pushable Clock at 1/16 s per tick, exact in binary: a 0.25 s segment is 4 ticks, a
 * 0.125 s gap 2, and 0 → 16 moves 4 per tick, so every Frame is a whole number. Each case runs
 * through both drivers (ADR-0027): `Machine.toStream`, and `Machine.run` on the Frame loop.
 */
const DT = 1 / 16

const linear = (t: number): number => t
const RUN = { duration: 0.25, repeatDelay: 0.125 }

/** Frames with these values: settled on the last when `settles`, never otherwise. */
const framesOf = (values: ReadonlyArray<number>, settles: boolean): Array<Frame.Frame<number>> =>
  values.map((value, i) => ({ value, done: settles && i === values.length - 1 }))

/** `stream` on a pushable Clock at `DT` per tick, for `ticks` ticks: its Frames. */
const onTheStream = <F>(stream: Stream.Stream<F, never, any>, ticks: number) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const fiber = yield* Stream.runCollect(stream.pipe(Stream.take(ticks))).pipe(
      Effect.provide(Layer.merge(clock.layer, InterpolatorRegistry.layer)),
      Effect.forkChild({ startImmediately: true }),
    )
    for (let i = 0; i < ticks; i++) yield* clock.advance(DT)
    return Array.from(yield* Fiber.join(fiber))
  })

/** `machine` on the Frame loop over a pushable Clock at `DT` per tick, for `ticks` ticks: the Frames its sink gets. */
const onTheLoop = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, ticks: number) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    return yield* Effect.gen(function* () {
      const frames: Array<F> = []
      const run = yield* machine.pipe(
        Machine.run((frame) => {
          frames.push(frame)
          return undefined
        }),
        Effect.forkChild({ startImmediately: true }),
      )
      for (let i = 0; i < ticks; i++) yield* clock.advance(DT)
      yield* Fiber.interrupt(run)
      return frames
    }).pipe(Effect.provide(FrameLoop.layer.pipe(Layer.provide(clock.layer))))
  })

/** A Primitive's two drivers, and the Frames both must give over `ticks` ticks. */
const bothDrivers = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, expected: ReadonlyArray<F>, ticks = 24) =>
  Effect.gen(function* () {
    expect(yield* onTheStream(Machine.toStream(machine), ticks), "Machine.toStream").toEqual(expected)
    expect(yield* onTheLoop(machine, ticks), "Machine.run").toEqual(expected)
  })

describe("repeatDelay holds after each run but the last (#91)", () => {
  it.effect("repeat 2: each run holds its end, 16, for 0.125 s; the last doesn't", () =>
    bothDrivers(
      Machine.animate(0, 16, { ...RUN, repeat: 2 }),
      framesOf([4, 8, 12, 16, 16, 16, 4, 8, 12, 16, 16, 16, 4, 8, 12, 16], true),
    ))

  it.effect("repeat 2, reversed every other run: each run holds its turning point", () =>
    bothDrivers(
      Machine.animate(0, 16, { ...RUN, repeat: 2, repeatType: "reverse" }),
      framesOf([4, 8, 12, 16, 16, 16, 12, 8, 4, 0, 0, 0, 4, 8, 12, 16], true),
    ))

  it.effect("reverse with repeat 1: the hold at `from`, then the second run", () =>
    bothDrivers(Machine.animate(0, 16, { ...RUN, reverse: true, repeat: 1 }), framesOf([12, 8, 4, 0, 0, 0, 12, 8, 4, 0], true)))

  it.effect("repeat Infinity: a hold after every run, never settling", () =>
    bothDrivers(
      Machine.animate(0, 16, { ...RUN, repeat: Infinity }),
      framesOf([4, 8, 12, 16, 16, 16, 4, 8, 12, 16, 16, 16, 4, 8, 12, 16, 16, 16], false),
      18,
    ))

  it.effect("repeat Infinity, reversed every other run: a hold at every turning point, never settling", () =>
    bothDrivers(
      Machine.animate(0, 16, { ...RUN, repeat: Infinity, repeatType: "reverse" }),
      framesOf([4, 8, 12, 16, 16, 16, 12, 8, 4, 0, 0, 0, 4, 8, 12, 16, 16, 16], false),
      18,
    ))

  it.effect("delay with repeatDelay: the delay once at the start, the gap between runs", () =>
    bothDrivers(
      Machine.animate(0, 16, { ...RUN, repeat: 1, delay: 0.125 }),
      framesOf([0, 0, 4, 8, 12, 16, 16, 16, 4, 8, 12, 16], true),
    ))

  it.effect("no repeat: no hold, as without a repeatDelay", () =>
    bothDrivers(Machine.animate(0, 16, RUN), framesOf([4, 8, 12, 16], true)))

  it.effect("animateValues, repeat 1: the spine's tween legs hold between runs", () =>
    Effect.gen(function* () {
      const machine = yield* Machine.animateValues({ x: 0 }, { x: 16 }, { ...RUN, repeat: 1 }).pipe(
        Effect.provide(InterpolatorRegistry.layer),
      )
      const expected = framesOf([4, 8, 12, 16, 16, 16, 4, 8, 12, 16], true).map(({ value, done }) => ({ value: { x: value }, done }))
      yield* bothDrivers(machine, expected)
    }))
})

describe("the Frames are Motion's, at 1/16 s ticks", () => {
  const cases = [
    ["repeat 2", { duration: 0.25, repeatDelay: 0.125, repeat: 2, repeatType: "loop", delay: 0, ease: linear }],
    ["repeat 3, reverse", { duration: 0.25, repeatDelay: 0.125, repeat: 3, repeatType: "reverse", delay: 0, ease: linear }],
    ["repeat Infinity, mirror, a delay", { duration: 0.5, repeatDelay: 0.25, repeat: Infinity, repeatType: "mirror", delay: 0.125, ease: linear }],
    ["a gap longer than a run, reverse", { duration: 0.125, repeatDelay: 0.375, repeat: 2, repeatType: "reverse", delay: 0, ease: linear }],
  ] as const satisfies ReadonlyArray<readonly [string, RunOptions]>
  for (const [name, options] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const frames = yield* onTheStream(Machine.toStream(Machine.animate(-5, 20, options)), 40)
        expect(frames.length).toBeGreaterThanOrEqual(10)
        for (const [i, frame] of frames.entries()) {
          expect(frame.value, `tick ${i + 1}`).toBeCloseTo(motionRunAt((i + 1) * DT, -5, 20, options), 9)
        }
      }))
  }
})
