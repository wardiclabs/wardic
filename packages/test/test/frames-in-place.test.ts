import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/**
 * A Frame handed to a sink is the run's until the next tick (ADR-0030, decision 11; #111): a
 * step may rewrite its Frame in place. `Machine.toStream` copies a record Frame before it emits,
 * so a Stream consumer owns each emission.
 */

/** A machine that rewrites one Frame per run, its `value` and `velocity` records too, settling on its third step. */
const rewriting = (): Machine.Machine<Frame.MultiPhysics> =>
  Machine.make({
    settles: true,
    span: { name: "test.rewriting", attributes: {} },
    start: () => {
      const frame = { value: { x: 0 }, velocity: { x: 0 }, done: false }
      let steps = 0
      return () => {
        steps++
        frame.value.x = steps
        frame.velocity.x = -steps
        frame.done = steps === 3
        return frame
      }
    },
  })

/** `machine`'s Frames through `Machine.toStream`, on a Clock fed `dts`. */
const collect = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, dts: ReadonlyArray<number>) =>
  Stream.runCollect(Machine.toStream(machine)).pipe(
    Effect.provide(TestClock.layer(dts)),
    Effect.map((frames) => Array.from(frames)),
  )

describe("Machine.toStream hands each consumer its own Frame", () => {
  it.effect("a record Frame rewritten in place: each emission keeps its values, in objects of its own", () =>
    Effect.gen(function* () {
      const frames = yield* collect(rewriting(), [1 / 60, 1 / 60, 1 / 60])
      expect(frames).toEqual([
        { value: { x: 1 }, velocity: { x: -1 }, done: false },
        { value: { x: 2 }, velocity: { x: -2 }, done: false },
        { value: { x: 3 }, velocity: { x: -3 }, done: true },
      ])
      expect(new Set(frames).size).toBe(3)
      expect(new Set(frames.map((frame) => frame.value)).size).toBe(3)
      expect(new Set(frames.map((frame) => frame.velocity)).size).toBe(3)
    }))

  it.effect("a number Frame passes as it is: a leaf's is fresh each tick", () =>
    Effect.gen(function* () {
      const dts = [1 / 60, 1 / 30, 1 / 60, 1 / 60]
      const machine = Machine.spring(10, { stiffness: 400 })
      const step = machine.start()
      const frames = yield* collect(machine, dts)
      expect(frames).toEqual(dts.map((dt) => step(dt)))
      expect(new Set(frames).size).toBe(dts.length)
    }))
})
