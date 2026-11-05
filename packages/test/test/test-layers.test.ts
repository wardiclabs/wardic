// `@wardic/test`'s Layers hold their state per build (#618, decision 7).
//
// - TL1: two subscribers replaying the Clock's frames read `now` as one script's total, not twice it.
// - TL2: one Clock Layer built twice shares no time.
// - TL3: the Renderer Layer keeps nothing: it commits and projects with no state to grow.
import { expect, it } from "@effect/vitest"
import * as Clock from "@wardic/core/Clock"
import * as Renderer from "@wardic/core/Renderer"
import { TestClock, TestRenderer } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

const FRAMES = [0.1, 0.1, 0.1]

it.effect("TL1: two subscribers read now as one script's total", () =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    yield* Stream.runDrain(clock.ticks)
    yield* Stream.runDrain(clock.ticks)
    expect(clock.now()).toBeCloseTo(300, 6)
  }).pipe(Effect.provide(TestClock.layer(FRAMES))))

it.effect("TL2: one Clock Layer built twice shares no time", () =>
  Effect.gen(function* () {
    const layer = TestClock.layer(FRAMES)
    const first = yield* Effect.gen(function* () {
      const clock = yield* Clock.Clock
      yield* Stream.runDrain(clock.ticks)
      return clock.now()
    }).pipe(Effect.provide(layer))
    const second = yield* Effect.gen(function* () {
      const clock = yield* Clock.Clock
      return clock.now()
    }).pipe(Effect.provide(layer))
    expect(first).toBeCloseTo(300, 6)
    expect(second, "a fresh build starts at 0").toBe(0)
  }))

it.effect("TL3: the Renderer Layer keeps nothing", () =>
  Effect.gen(function* () {
    const renderer = yield* Renderer.Renderer
    const patch = renderer.project({ opacity: 0.5 })
    expect(patch).toEqual({ opacity: 0.5 })
    renderer.commit({}, patch)
    expect(Object.keys(renderer)).toEqual(["project", "commit"])
  }).pipe(Effect.provide(TestRenderer.layer)))
