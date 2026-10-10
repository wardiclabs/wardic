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

/**
 * `delay` holds once, before an `animate` run's first segment and before `keyframes`' first stop,
 * as Motion's does (#77): every later segment starts on the tick after the one before it settles.
 * Before, every segment held the whole `delay` again, so a staggered tween with a `repeat` waited
 * its stagger before each repeat (ADR-0007).
 *
 * On a pushable Clock at 1/16 s per tick, exact in binary so no rounding enters the timing: a
 * 0.25 s segment is 4 ticks, a 0.125 s `delay` is 2, and 0 → 16 moves 4 per tick, so every Frame
 * is a whole number. Each case runs through both drivers (ADR-0027): the Tier 2 `Stream`
 * (`Machine.toStream`), and the machine on the Frame loop (`Machine.run`). `Machine.animateValues`
 * on the loop is the spine's own path for a `tween` transition. Since #94 the hold is
 * `Machine.delay`'s, outside the segments; at 1/16 s ticks its Frames are the stepper's exactly
 * (ADR-0028, decision 9).
 */
const DT = 1 / 16
const SEGMENT = { duration: 0.25, delay: 0.125 }

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
    expect(yield* onTheStream(Machine.toStream(machine), ticks), "the Stream").toEqual(expected)
    expect(yield* onTheLoop(machine, ticks), "the machine on the Frame loop").toEqual(expected)
  })

describe("delay holds once, before the first segment (#77)", () => {
  it.effect("animate, repeat 2: the hold, then three segments back to back", () => {
    const options = { ...SEGMENT, repeat: 2 }
    return bothDrivers(
      Machine.animate(0, 16, options),
      framesOf([0, 0, 4, 8, 12, 16, 4, 8, 12, 16, 4, 8, 12, 16], true),
    )
  })

  it.effect("animate, repeat 2 with yoyo: forward, back, forward, with one hold", () => {
    const options = { ...SEGMENT, repeat: 2, yoyo: true }
    return bothDrivers(
      Machine.animate(0, 16, options),
      framesOf([0, 0, 4, 8, 12, 16, 12, 8, 4, 0, 4, 8, 12, 16], true),
    )
  })

  it.effect("animate, reverse with repeat 1: the hold at `to`, then two runs back to `from`", () => {
    const options = { ...SEGMENT, reverse: true, repeat: 1 }
    return bothDrivers(
      Machine.animate(0, 16, options),
      framesOf([16, 16, 12, 8, 4, 0, 12, 8, 4, 0], true),
    )
  })

  it.effect("animate, repeat Infinity: the hold once, then segment after segment, never settling", () => {
    const options = { ...SEGMENT, repeat: Infinity }
    return bothDrivers(
      Machine.animate(0, 16, options),
      framesOf([0, 0, 4, 8, 12, 16, 4, 8, 12, 16, 4, 8, 12, 16, 4, 8, 12, 16], false),
      18,
    )
  })

  it.effect("animate, repeat Infinity with yoyo: the hold once, then forward and back, never settling", () => {
    const options = { ...SEGMENT, repeat: Infinity, yoyo: true }
    return bothDrivers(
      Machine.animate(0, 16, options),
      framesOf([0, 0, 4, 8, 12, 16, 12, 8, 4, 0, 4, 8, 12, 16, 12, 8, 4, 0], false),
      18,
    )
  })

  it.effect("keyframes: the hold before the first stop, none at the others", () => {
    const options = { duration: 0.75, delay: 0.125 }
    return bothDrivers(
      Machine.keyframes([0, 16, 8, 24], options),
      framesOf([0, 0, 4, 8, 12, 16, 14, 12, 10, 8, 12, 16, 20, 24], true),
    )
  })

  it.effect("animateValues, repeat 2: the spine's tween legs hold once", () =>
    Effect.gen(function* () {
      const options = { ...SEGMENT, repeat: 2 }
      const expected = framesOf([0, 0, 4, 8, 12, 16, 4, 8, 12, 16, 4, 8, 12, 16], true).map(({ value, done }) => ({
        value: { x: value },
        done,
      }))
      const machine = yield* Machine.animateValues({ x: 0 }, { x: 16 }, options).pipe(Effect.provide(InterpolatorRegistry.layer))
      yield* bothDrivers(machine, expected)
    }))
})

describe("unchanged by #77", () => {
  it.effect("one segment still holds its delay", () =>
    bothDrivers(Machine.animate(0, 16, SEGMENT), framesOf([0, 0, 4, 8, 12, 16], true)))

  it.effect("a repeat with no delay runs its segments back to back", () => {
    const options = { duration: 0.25, repeat: 1 }
    return bothDrivers(Machine.animate(0, 16, options), framesOf([4, 8, 12, 16, 4, 8, 12, 16], true))
  })

  it.effect("an infinite yoyo with no delay cycles forward and back", () => {
    const options = { duration: 0.25, repeat: Infinity, yoyo: true }
    return bothDrivers(
      Machine.animate(0, 16, options),
      framesOf([4, 8, 12, 16, 12, 8, 4, 0, 4, 8, 12, 16], false),
      12,
    )
  })
})
