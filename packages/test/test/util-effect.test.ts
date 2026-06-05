import { delay, type Frame, group, onFrame, onSettle, tween, velocityOf, wait } from "@wardic/core"
import { TestClock } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it } from "@effect/vitest"

it.effect("delay completes once accumulated dt reaches the target", () =>
  // [0.25, 0.25, 0.25] accumulates 0.25 → 0.50 (>= 0.5, stop). Resolves cleanly.
  Effect.gen(function* () {
    const result = yield* delay(0.5)
    expect(result).toBeUndefined()
  }).pipe(Effect.provide(TestClock.layer([0.25, 0.25, 0.25]))),
)

it.effect("onFrame taps every frame without altering the stream", () =>
  Effect.gen(function* () {
    const seen: Array<number> = []
    yield* Stream.runDrain(onFrame(tween(0, 10, { duration: 1 }), (frame) => seen.push(frame.value)))
    expect(seen).toEqual([5, 10])
  }).pipe(Effect.provide(TestClock.layer([0.5, 0.5]))),
)

it.effect("onSettle fires once after the final frame", () =>
  Effect.gen(function* () {
    let settled = false
    yield* onSettle(tween(0, 10, { duration: 1 }), () => {
      settled = true
    })
    expect(settled).toBe(true)
  }).pipe(Effect.provide(TestClock.layer([0.5, 0.5]))),
)

it.effect("wait stops at the first frame satisfying the predicate", () =>
  Effect.gen(function* () {
    const seen: Array<number> = []
    yield* wait(
      onFrame(tween(0, 10, { duration: 1 }), (frame) => seen.push(frame.value)),
      (frame: Frame<number>) => frame.value >= 5,
    )
    expect(seen).toEqual([2.5, 5])
  }).pipe(Effect.provide(TestClock.layer([0.25, 0.25, 0.25, 0.25]))),
)

it.effect("group runs streams concurrently to completion", () =>
  Effect.gen(function* () {
    const a: Array<number> = []
    const b: Array<number> = []
    yield* group(
      onFrame(tween(0, 10, { duration: 1 }), (frame) => a.push(frame.value)),
      onFrame(tween(0, 20, { duration: 1 }), (frame) => b.push(frame.value)),
    )
    expect(a.at(-1)).toBe(10)
    expect(b.at(-1)).toBe(20)
  }).pipe(Effect.provide(TestClock.layer([0.5, 0.5]))),
)

it.effect("velocityOf zips values with Clock.ticks for variable frame times", () =>
  // Samples: 0, 1, 3, 7. Frames: 0.5, 0.25, 0.25 (non-uniform).
  // Frame 1: current=0, no previous → 0.
  // Frame 2: previous=0, current=1, dt=0.25 → (1-0)/0.25 = 4.
  // Frame 3: previous=1, current=3, dt=0.25 → (3-1)/0.25 = 8.
  // zip terminates with the shorter ticks stream (3 frames), so the trailing
  // value (7) is dropped.
  Effect.gen(function* () {
    const values = Stream.fromIterable([0, 1, 3, 7])
    const collected = yield* Stream.runCollect(velocityOf(values))
    expect(collected).toEqual([0, 4, 8])
  }).pipe(Effect.provide(TestClock.layer([0.5, 0.25, 0.25]))),
)

it.effect("velocityOf emits 0 for the first frame", () =>
  Effect.gen(function* () {
    const values = Stream.fromIterable([42, 50])
    const collected = yield* Stream.runCollect(velocityOf(values))
    expect(collected[0]).toBe(0)
  }).pipe(Effect.provide(TestClock.layer([0.1, 0.1]))),
)
