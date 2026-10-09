import {
  type Frame,
  FrameLoop,
  FrameLoopLive,
  type InterpolatorRegistry,
  InterpolatorRegistryLive,
  type Machine,
  MAX_DT,
  springBlendMachine,
  springValues,
  springValuesMachine,
} from "@wardic/core"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"

/**
 * `springValues` clamps `dt` at `MAX_DT`, as every leaf does (#78): one 30 s dt, a hidden tab's
 * gap, advances as one 0.5 s step. Unclamped, it lands the spring on its target in one Frame.
 *
 * Each run fed `STALL` is checked against the same run fed `CLAMPED`, and its first Frame is
 * still in flight, so the two can't match by both landing. Both drivers (ADR-0027): the Tier 2
 * `Stream`, and the machines on the Frame loop, which is how the binding runs every spring. The
 * other Clock consumers' clamps are #23's to pin.
 */
const STALL: ReadonlyArray<number> = [30, 1 / 60]
const CLAMPED: ReadonlyArray<number> = [MAX_DT, 1 / 60]

const TARGET = { x: 100, y: -40 }
const OPTIONS = { stiffness: 170, damping: 26 }
const FROM = { x: 0, y: 0 }

/** The stalled run's Frames are the clamped run's: two of them, the first still in flight. */
const expectClamped = <F extends Frame<unknown>>(stalled: ReadonlyArray<F>, clamped: ReadonlyArray<F>) => {
  expect(stalled).toEqual(clamped)
  expect(stalled).toHaveLength(2)
  expect(stalled.at(0)?.done).toBe(false)
}

/** `machine` on the Frame loop over a pushable Clock fed `dts`: the Frames its sink gets. */
const onTheLoop = <F extends Frame<unknown>>(machine: Machine<F>, dts: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    return yield* Effect.gen(function* () {
      const loop = yield* FrameLoop
      const frames: Array<F> = []
      const run = yield* loop
        .run(machine, (frame) => {
          frames.push(frame)
          return undefined
        })
        .pipe(Effect.forkChild({ startImmediately: true }))
      for (const dt of dts) yield* clock.advance(dt)
      yield* Fiber.interrupt(run)
      return frames
    }).pipe(Effect.provide(FrameLoopLive.pipe(Layer.provide(clock.layer))))
  })

/** One machine, built once, run on two loops: fed `STALL`, then `CLAMPED`. */
const stalledOnTheLoop = <F extends Frame<unknown>>(build: Effect.Effect<Machine<F>, never, InterpolatorRegistry>) =>
  Effect.gen(function* () {
    const machine = yield* build.pipe(Effect.provide(InterpolatorRegistryLive))
    expectClamped(yield* onTheLoop(machine, STALL), yield* onTheLoop(machine, CLAMPED))
  })

describe("springValues clamps a stall's dt at MAX_DT (#78)", () => {
  it.effect("the Stream", () =>
    Effect.gen(function* () {
      const collect = (dts: ReadonlyArray<number>) =>
        Stream.runCollect(springValues(TARGET, OPTIONS, FROM)).pipe(
          Effect.provide(TestClock.layer(dts)),
          Effect.map((frames) => Array.from(frames)),
        )
      expectClamped(yield* collect(STALL), yield* collect(CLAMPED))
    }))

  it.effect("on the Frame loop, springValuesMachine: the spine's numeric legs, presence's exit, drag's release", () =>
    stalledOnTheLoop(Effect.succeed(springValuesMachine(TARGET, OPTIONS, FROM))))

  it.effect("on the Frame loop, springBlendMachine: the spine's string legs", () =>
    stalledOnTheLoop(
      springBlendMachine({ "background-color": "#102030", width: "10px" }, { "background-color": "#ffffff", width: "200px" }, OPTIONS),
    ))
})
