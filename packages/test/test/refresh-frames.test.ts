import * as Clock from "@wardic/core/Clock"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import { TestClock, TestLive } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"

/**
 * `@wardic/test`'s Refresh frame sources (ADR-0031, decision 6). `TestClock.pushable()`'s keeps the
 * contract's order rules, and one `advance` is one Refresh frame in the web's order: the frames
 * requested so far (a flush gate's flush), then the Clock's tick. `TestLive`'s never calls back.
 */
describe("TestClock.pushable()'s Refresh frames", () => {
  it.effect("a frame requested before an advance runs in it, before the tick", () =>
    Effect.gen(function* () {
      const clock = yield* TestClock.pushable()
      const events: Array<string> = []
      const program = Effect.gen(function* () {
        const frames = yield* RefreshFrameSource.RefreshFrameSource
        const { ticks } = yield* Clock.Clock
        const fiber = yield* Stream.runForEach(ticks, () => Effect.sync(() => void events.push("tick"))).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        const { requestFrame } = frames
        requestFrame((t) => void events.push(`frame ${t}`))
        expect(events).toEqual([]) // never inside requestFrame
        yield* clock.advance(1 / 16)
        expect(events).toEqual(["frame 62.5", "tick"])
        yield* Fiber.interrupt(fiber)
      })
      yield* program.pipe(Effect.provide(clock.layer))
    }))

  it.effect("runs a frame's callbacks in request order, and one requested while they run waits for the next advance", () =>
    Effect.gen(function* () {
      const clock = yield* TestClock.pushable()
      const events: Array<string> = []
      yield* Effect.gen(function* () {
        const { requestFrame } = yield* RefreshFrameSource.RefreshFrameSource
        requestFrame(() => {
          events.push("a")
          requestFrame(() => void events.push("c"))
        })
        requestFrame(() => void events.push("b"))
        yield* clock.advance()
        expect(events).toEqual(["a", "b"])
        yield* clock.advance()
        expect(events).toEqual(["a", "b", "c"])
      }).pipe(Effect.provide(clock.layer))
    }))

  it.effect("a frame cancelled before its turn never runs, even from an earlier callback in the same frame", () =>
    Effect.gen(function* () {
      const clock = yield* TestClock.pushable()
      const events: Array<string> = []
      yield* Effect.gen(function* () {
        const { requestFrame, cancelFrame } = yield* RefreshFrameSource.RefreshFrameSource
        const early = requestFrame(() => void events.push("early"))
        cancelFrame(early)
        let late: unknown = undefined
        requestFrame(() => {
          events.push("first")
          cancelFrame(late)
        })
        late = requestFrame(() => void events.push("late"))
        yield* clock.advance()
        yield* clock.advance()
        expect(events).toEqual(["first"])
      }).pipe(Effect.provide(clock.layer))
    }))
})

describe("TestLive's Refresh frames", () => {
  it.effect("never call back", () =>
    Effect.gen(function* () {
      const { requestFrame } = yield* RefreshFrameSource.RefreshFrameSource
      let called = false
      requestFrame(() => {
        called = true
      })
      yield* Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })
      expect(called).toBe(false)
    }).pipe(Effect.provide(TestLive)))
})
