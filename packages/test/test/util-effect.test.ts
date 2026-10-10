import * as Clock from "@wardic/core/Clock"
import * as Velocity from "@wardic/core/Velocity"
import { TestClock } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it } from "@effect/vitest"

it.effect("Clock.delay completes once accumulated dt reaches the target", () =>
  // [0.25, 0.25, 0.25] accumulates 0.25 → 0.50 (>= 0.5, stop). Resolves cleanly.
  Effect.gen(function* () {
    const result = yield* Clock.delay(0.5)
    expect(result).toBeUndefined()
  }).pipe(Effect.provide(TestClock.layer([0.25, 0.25, 0.25]))),
)

it.effect("Velocity.of zips values with Clock.ticks for variable frame times", () =>
  // Samples: 0, 1, 3, 7. Frames: 0.5, 0.25, 0.25 (non-uniform).
  // Frame 1: current=0, no previous → 0.
  // Frame 2: previous=0, current=1, dt=0.25 → (1-0)/0.25 = 4.
  // Frame 3: previous=1, current=3, dt=0.25 → (3-1)/0.25 = 8.
  // zip terminates with the shorter ticks stream (3 frames), so the trailing
  // value (7) is dropped.
  Effect.gen(function* () {
    const values = Stream.fromIterable([0, 1, 3, 7])
    const collected = yield* Stream.runCollect(Velocity.of(values))
    expect(collected).toEqual([0, 4, 8])
  }).pipe(Effect.provide(TestClock.layer([0.5, 0.25, 0.25]))),
)

it.effect("Velocity.of emits 0 for the first frame", () =>
  Effect.gen(function* () {
    const values = Stream.fromIterable([42, 50])
    const collected = yield* Stream.runCollect(Velocity.of(values))
    expect(collected[0]).toBe(0)
  }).pipe(Effect.provide(TestClock.layer([0.1, 0.1]))),
)
