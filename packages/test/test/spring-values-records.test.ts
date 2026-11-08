import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/**
 * `springValues`' Frame by index (#663): its `positions` and `velocities`, in `keys`' order, are its
 * records' values, and `records: "value"` stops the run writing its velocity record, which then holds
 * its start. `toStream` emits its records alone, each its consumer's own.
 */

const TARGET = { x: 100, y: -40, scale: 1.5 }
const OPTIONS = { stiffness: 300, damping: 10, mass: 2, restDelta: 1e-6, restSpeed: 1e-6 }
const START = { from: { x: 0, y: 10, scale: 1 }, velocity: { x: 200, y: 0, scale: -3 } }
const DTS = Array.from({ length: 40 }, () => 1 / 60)

/** A run's Frames stepped by hand, each copied whole as it was that tick. */
const stepped = (start: Machine.SpringValuesStart) => {
  const step = Machine.springValues(TARGET, OPTIONS, start).start()
  return DTS.map((dt) => {
    const frame = step(dt)
    return {
      value: { ...frame.value },
      velocity: { ...frame.velocity },
      keys: [...frame.keys],
      positions: [...frame.positions],
      velocities: [...frame.velocities],
      done: frame.done,
    }
  })
}

/** A record of `keys` to `xs`, in order. */
const recordOf = (keys: ReadonlyArray<string>, xs: ReadonlyArray<number>): Record<string, number> =>
  Object.fromEntries(keys.map((key, i) => [key, xs[i]!]))

describe("springValues' Frame by index (#663)", () => {
  it("SV1: by default its arrays are its records, in its keys' order, every tick", () => {
    for (const frame of stepped(START)) {
      expect(frame.keys).toEqual(["x", "y", "scale"])
      expect(recordOf(frame.keys, frame.positions)).toEqual(frame.value)
      expect(recordOf(frame.keys, frame.velocities)).toEqual(frame.velocity)
    }
  })

  it("SV2: records \"value\" moves the same, and leaves its velocity record at its start", () => {
    const both = stepped(START)
    const value = stepped({ ...START, records: "value" })
    value.forEach((frame, i) => {
      expect(frame.value).toEqual(both[i]!.value)
      expect(recordOf(frame.keys, frame.velocities), "its velocities, by index").toEqual(both[i]!.velocity)
      expect(frame.velocity, "the record it wasn't asked to write").toEqual(START.velocity)
      expect(frame.done).toBe(both[i]!.done)
    })
  })

  it("SV3: a spring that ends at its duration lands every key, by index and in the records it writes", () => {
    const step = Machine.springValues(TARGET, { duration: 0.3, bounce: 0.2 }, { from: START.from, records: "value" }).start()
    let frame = step(1 / 60)
    while (!frame.done) frame = step(1 / 60)
    expect(recordOf(frame.keys, frame.positions)).toEqual(TARGET)
    expect(frame.value).toEqual(TARGET)
    expect(frame.velocities).toEqual([0, 0, 0])
  })

  it.effect("SV4: toStream emits its records alone, each emission its consumer's own", () =>
    Effect.gen(function* () {
      const frames = yield* Stream.runCollect(Machine.toStream(Machine.springValues(TARGET, OPTIONS, START))).pipe(
        Effect.provide(TestClock.layer(DTS)),
        Effect.map((emitted) => Array.from(emitted)),
      )
      expectTypeOf(frames).toEqualTypeOf<Array<Frame.MultiPhysics>>()
      const both = stepped(START)
      frames.forEach((frame, i) => {
        expect(frame).toEqual({ value: both[i]!.value, velocity: both[i]!.velocity, done: both[i]!.done })
      })
      expect(new Set(frames.map((frame) => frame.value)).size, "each emission's records are its own").toBe(frames.length)
    }))
})
