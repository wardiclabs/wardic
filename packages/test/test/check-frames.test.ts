import type * as Clock from "@wardic/core/Clock"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"

/**
 * `FrameLoop.CheckFrames` (ADR-0030, decision 7; #112): off by default; on, a run whose step
 * produces a NaN or an Infinity dies with `NonFiniteFrame`, naming the key and the value, and its
 * run's span. The check wraps the run's sink at its start, read from the caller's fiber.
 */

/** A machine whose second Frame is `bad`, settling on its fourth; the others are `good`. */
const goesBad = <V>(name: string, good: V, bad: V): Machine.Machine<Frame.Frame<V>> =>
  Machine.make({
    settles: true,
    span: { name, attributes: {} },
    start: () => {
      let steps = 0
      return () => {
        steps++
        if (steps === 2) return { value: bad, done: false }
        return { value: good, done: steps === 4 }
      }
    },
  })

/** One healthy machine: a tween, which never goes bad. */
const healthy = () => Machine.tween(0, 10, { duration: 0.1 })

/**
 * `machine` and a healthy run on one Frame loop over a pushable Clock, fed 8 ticks, with `extra`
 * merged beside the loop (`Layer.mergeAll`, as an app merges it beside `DomLive`): the machine's
 * exit and Frames, and the healthy run's exit and Frame count.
 */
const onTheLoop = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, extra: Layer.Layer<never> = Layer.empty) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const env = Layer.mergeAll(FrameLoop.layer.pipe(Layer.provide(clock.layer)), extra)
    return yield* Effect.gen(function* () {
      const frames: Array<F> = []
      let others = 0
      const run = yield* machine.pipe(
        Machine.run((frame) => {
          frames.push(frame)
          return undefined
        }),
        Effect.exit,
        Effect.forkChild({ startImmediately: true }),
      )
      const other = yield* healthy().pipe(
        Machine.run(() => {
          others++
          return undefined
        }),
        Effect.forkChild({ startImmediately: true }),
      )
      for (let i = 0; i < 8; i++) yield* clock.advance(1 / 60)
      const exit = yield* Fiber.join(run)
      const otherExit = yield* Fiber.await(other)
      return { exit, frames, others, otherExit }
    }).pipe(Effect.provide(env))
  })

const checkOn = Layer.succeed(FrameLoop.CheckFrames, true)

/** The defect `exit` died with. */
const defectOf = (exit: Exit.Exit<unknown>): unknown => {
  if (Exit.isSuccess(exit)) return undefined
  return Cause.squash(exit.cause)
}

describe("FrameLoop.CheckFrames on", () => {
  const cases: ReadonlyArray<readonly [string, Machine.Machine<Frame.Frame<unknown>>, Option.Option<string>, unknown]> = [
    ["a number Frame's NaN", goesBad("test.number", 1, Number.NaN), Option.none(), Number.NaN],
    ["a record's key at Infinity", goesBad("test.record", { x: 1, y: 2 }, { x: 1, y: Number.POSITIVE_INFINITY }), Option.some("y"), Number.POSITIVE_INFINITY],
    [
      "a blended string holding NaN",
      goesBad("test.string", { transform: "translateX(4px)" }, { transform: "translateX(NaNpx)" }),
      Option.some("transform"),
      "translateX(NaNpx)",
    ],
  ]
  for (const [name, machine, key, value] of cases) {
    it.effect(`${name}: the run dies with NonFiniteFrame, its key and value, before its sink sees it`, () =>
      Effect.gen(function* () {
        const { exit, frames, others, otherExit } = yield* onTheLoop(machine, checkOn)
        const defect = defectOf(exit)
        expect(defect).toBeInstanceOf(FrameLoop.NonFiniteFrame)
        expect(defect).toMatchObject({ _tag: "NonFiniteFrame", key, value })
        expect(frames).toHaveLength(1)
        // The healthy run on the same loop goes on past the failure, on the second tick, and settles.
        expect(others).toBeGreaterThan(2)
        expect(Exit.isSuccess(otherExit)).toBe(true)
      }))
  }

  it.effect("the cause names the run: it pretty-prints its span, and the message names the key", () =>
    Effect.gen(function* () {
      const { exit } = yield* onTheLoop(goesBad("test.record", { x: 1 }, { x: Number.NaN }), checkOn)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const pretty = Cause.pretty(exit.cause)
      expect(pretty).toContain("NonFiniteFrame")
      expect(pretty).toContain("a non-finite Frame: x is NaN")
      expect(pretty).toContain("at test.record")
    }))

  it.effect("finite Frames pass: the run settles with every Frame", () =>
    Effect.gen(function* () {
      const { exit, frames } = yield* onTheLoop(goesBad("test.fine", { x: 1, label: "4px" }, { x: 2, label: "5px" }), checkOn)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(frames).toHaveLength(4)
    }))
})

describe("FrameLoop.CheckFrames off, the default", () => {
  it.effect("the same step's Frames reach the sink unchecked, NaN included, and the run settles", () =>
    Effect.gen(function* () {
      const { exit, frames } = yield* onTheLoop(goesBad("test.number", 1, Number.NaN))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(frames.map((frame) => frame.value)).toEqual([1, Number.NaN, 1, 1])
    }))

  it.effect("set to false beside the Environment, it stays off", () =>
    Effect.gen(function* () {
      const { exit } = yield* onTheLoop(goesBad("test.number", 1, Number.NaN), Layer.succeed(FrameLoop.CheckFrames, false))
      expect(Exit.isSuccess(exit)).toBe(true)
    }))
})

/**
 * Where the check is read: from the run's caller, once per run, not when the Frame loop is built
 * (ADR-0030, decision 7). An app merges it beside `DomLive`, a sibling of `FrameLoop.layer`, so a
 * read at the loop's build wouldn't see it.
 */
describe("FrameLoop.CheckFrames is read from the run's caller", () => {
  /** `machine` run on a loop built over `loopLayer`, with `provideToRun` provided to the run alone. */
  const runOn = <F extends Frame.Frame<unknown>>(
    machine: Machine.Machine<F>,
    loopLayer: (clock: Layer.Layer<Clock.Clock>) => Layer.Layer<FrameLoop.FrameLoop>,
    provideToRun: (run: Effect.Effect<F, never, FrameLoop.FrameLoop>) => Effect.Effect<F, never, FrameLoop.FrameLoop>,
  ) =>
    Effect.gen(function* () {
      const clock = yield* TestClock.pushable()
      return yield* Effect.gen(function* () {
        const fiber = yield* provideToRun(machine.pipe(Machine.run(() => undefined))).pipe(
          Effect.exit,
          Effect.forkChild({ startImmediately: true }),
        )
        for (let i = 0; i < 6; i++) yield* clock.advance(1 / 60)
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(loopLayer(clock.layer)))
    })

  it.effect("provided to the run alone, it's on", () =>
    Effect.gen(function* () {
      const exit = yield* runOn(
        goesBad("test.number", 1, Number.NaN),
        (clock) => FrameLoop.layer.pipe(Layer.provide(clock)),
        Effect.provideService(FrameLoop.CheckFrames, true),
      )
      expect(defectOf(exit)).toBeInstanceOf(FrameLoop.NonFiniteFrame)
    }))

  it.effect("provided to the loop's build alone, a run whose caller doesn't see it isn't checked", () =>
    Effect.gen(function* () {
      const exit = yield* runOn(
        goesBad("test.number", 1, Number.NaN),
        (clock) => FrameLoop.layer.pipe(Layer.provide(Layer.merge(clock, checkOn))),
        (run) => run,
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }))
})
