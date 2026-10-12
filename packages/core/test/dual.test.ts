import * as Drag from "@wardic/core/Drag"
import type * as Frame from "@wardic/core/Frame"
import * as Renderer from "@wardic/core/Renderer"
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/**
 * The operations #95 made `dual`, the stream first (ADR-0028, decision 12): both forms give one
 * type, and both run. The type assertions run under `bun run typecheck` (`typecheck:tests`).
 */
const sample = (x: number, y: number): Drag.Sample => ({
  point: { x, y },
  offset: { x, y },
  delta: { x, y },
  velocity: { x, y },
  phase: "move",
  timeStamp: 0,
})
const samples: Stream.Stream<Drag.Sample> = Stream.make(sample(10, 20), sample(-30, 250))
const frames: Stream.Stream<Frame.Frame<Record<string, unknown>>> = Stream.make({ value: { x: 1 }, done: true })

describe("Drag.withinBounds, the stream first", () => {
  it("both forms give one type", () => {
    expectTypeOf(Drag.withinBounds(samples, { x: { min: 0 } })).toEqualTypeOf(samples.pipe(Drag.withinBounds({ x: { min: 0 } })))
    expectTypeOf(Drag.withinBounds(samples, {}, { elastic: 0.5 })).toEqualTypeOf<Stream.Stream<Drag.Sample>>()
  })

  it.effect("both forms run alike", () =>
    Effect.gen(function* () {
      const offsets = (stream: Stream.Stream<Drag.Sample>) =>
        Stream.runCollect(stream).pipe(Effect.map((all) => Array.from(all, (s) => s.offset)))
      const bounds = { x: { min: 0 }, y: { max: 200 } }
      expect(yield* offsets(Drag.withinBounds(samples, bounds, { elastic: 0.5 }))).toEqual(
        yield* offsets(samples.pipe(Drag.withinBounds(bounds, { elastic: 0.5 }))),
      )
      expect(yield* offsets(samples.pipe(Drag.withinBounds(bounds)))).toEqual([
        { x: 10, y: 20 },
        { x: 0, y: 200 },
      ])
    }))
})

describe("Renderer.applyTo, the stream first", () => {
  it("both forms give one type", () => {
    expectTypeOf(Renderer.applyTo(frames, "target")).toEqualTypeOf(frames.pipe(Renderer.applyTo("target")))
    expectTypeOf(Renderer.applyTo(frames, "target")).toEqualTypeOf<Effect.Effect<void, never, Renderer.Renderer>>()
  })
})
