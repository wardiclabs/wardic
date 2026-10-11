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
 * `springValues` clamps `dt` at `MAX_DT`, as every leaf does (#78): one 30 s dt, a hidden tab's
 * gap, advances as one 0.5 s step. Unclamped, it lands the spring on its target in one Frame.
 *
 * Each run fed `STALL` is checked against the same run fed `CLAMPED`, and its first Frame is
 * still in flight, so the two can't match by both landing. Both drivers (ADR-0027): the Tier 2
 * `Stream` (`Machine.toStream`), and the machines on the Frame loop (`Machine.run`), which is how
 * the binding runs every spring. The other Clock consumers' clamps are #23's to pin.
 */
const STALL: ReadonlyArray<number> = [30, 1 / 60]
const CLAMPED: ReadonlyArray<number> = [Machine.MAX_DT, 1 / 60]

const TARGET = { x: 100, y: -40 }
const OPTIONS = { stiffness: 170, damping: 26 }
const FROM = { x: 0, y: 0 }

/** The stalled run's Frames are the clamped run's: two of them, the first still in flight. */
const expectClamped = <F extends Frame.Frame<unknown>>(stalled: ReadonlyArray<F>, clamped: ReadonlyArray<F>) => {
  expect(stalled).toEqual(clamped)
  expect(stalled).toHaveLength(2)
  expect(stalled.at(0)?.done).toBe(false)
}

/** A Frame a sink keeps, copied with its records (`value`, `velocity`): `springValues` rewrites one per run. */
const kept = <F extends Frame.Frame<unknown>>(frame: F): F => {
  const records: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(frame)) {
    if (typeof value === "object" && value !== null) records[field] = { ...value }
  }
  return { ...frame, ...records }
}

/**
 * `machine` on the Frame loop over a pushable Clock fed `dts`: the Frames its sink gets, each
 * copied, since a Frame handed to a sink is the run's until the next tick (ADR-0030, decision 11).
 */
const onTheLoop = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, dts: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    return yield* Effect.gen(function* () {
      const frames: Array<F> = []
      const run = yield* machine.pipe(
        Machine.run((frame) => {
          frames.push(kept(frame))
          return undefined
        }),
        Effect.forkChild({ startImmediately: true }),
      )
      for (const dt of dts) yield* clock.advance(dt)
      yield* Fiber.interrupt(run)
      return frames
    }).pipe(Effect.provide(FrameLoop.layer.pipe(Layer.provide(clock.layer))))
  })

/** One machine, built once, run on two loops: fed `STALL`, then `CLAMPED`. */
const stalledOnTheLoop = <F extends Frame.Frame<unknown>>(build: Effect.Effect<Machine.Machine<F>, never, InterpolatorRegistry.InterpolatorRegistry>) =>
  Effect.gen(function* () {
    const machine = yield* build.pipe(Effect.provide(InterpolatorRegistry.layer))
    expectClamped(yield* onTheLoop(machine, STALL), yield* onTheLoop(machine, CLAMPED))
  })

describe("springValues clamps a stall's dt at MAX_DT (#78)", () => {
  it.effect("the Stream", () =>
    Effect.gen(function* () {
      const collect = (dts: ReadonlyArray<number>) =>
        Stream.runCollect(Machine.toStream(Machine.springValues(TARGET, OPTIONS, FROM))).pipe(
          Effect.provide(TestClock.layer(dts)),
          Effect.map((frames) => Array.from(frames)),
        )
      expectClamped(yield* collect(STALL), yield* collect(CLAMPED))
    }))

  it.effect("on the Frame loop, springValues: the spine's numeric legs, presence's exit, drag's release", () =>
    stalledOnTheLoop(Effect.succeed(Machine.springValues(TARGET, OPTIONS, FROM))))

  it.effect("on the Frame loop, springBlend: the spine's string legs", () =>
    stalledOnTheLoop(
      Machine.springBlend(
        { "background-color": "#102030", width: "10px" },
        { "background-color": "#ffffff", width: "200px" },
        OPTIONS,
      ),
    ))
})
