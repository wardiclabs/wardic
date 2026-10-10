import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

it.effect("chase tracks a moving target and never auto-settles", () => {
  // Arrange — supply a fixed number of ticks, with a target that moves on every read.
  // Each call to `getTarget` advances `target` by 10, so the spring never stabilizes.
  const ticks = TestClock.frames(60, 1 / 60)
  let target = 0
  const getTarget = () => {
    target += 10
    return target
  }

  // Act and assert inside a single Effect.gen. The TestClock layer is provided via
  // .pipe so the Clock requirement is satisfied before it.effect runs the Effect.
  return Effect.gen(function* () {
    const frames = yield* Stream.runCollect(Machine.toStream(Machine.chase(getTarget)))

    // Assert — `chase` emits exactly one frame per tick (no auto-termination).
    expect(frames.length).toBe(ticks.length)
  }).pipe(Effect.provide(TestClock.layer(ticks)))
})

it.effect("chase cancellation via Stream.take(n) yields exactly n frames", () => {
  // Arrange — supply more ticks than we'll take, plus a moving target.
  const ticks = TestClock.frames(60, 1 / 60)
  const take = 5
  let target = 0
  const getTarget = () => {
    target += 1
    return target
  }

  // Act — cap the stream with Stream.take before collecting.
  return Effect.gen(function* () {
    const frames = yield* Stream.runCollect(Machine.toStream(Machine.chase(getTarget)).pipe(Stream.take(take)))

    // Assert — exactly `take` frames make it through.
    expect(frames.length).toBe(take)
  }).pipe(Effect.provide(TestClock.layer(ticks)))
})
