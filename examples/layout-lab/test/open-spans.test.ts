// The timeline's open-span counter, which decides each run's `clock` (cold / warm,
// issue #14): `openCount("wardic.clock") > 0` at the trigger means the Clock was
// already ticking. The counter is kept separately from the span ring so a long-lived
// span still counts after newer spans push its record out.
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { describe, expect, it } from "vitest"
import { makeTimeline } from "../src/probe/timeline.ts"

describe("Timeline.openCount", () => {
  it("counts a recorded span while it is open, and not after it ends", async () => {
    const timeline = makeTimeline()
    let during = -1
    await Effect.runPromise(
      Effect.sync(() => {
        during = timeline.openCount("wardic.clock")
      }).pipe(Effect.withSpan("wardic.clock"), Effect.provide(timeline.layer)),
    )
    expect(during).toBe(1)
    expect(timeline.openCount("wardic.clock")).toBe(0)
  })

  it("ignores spans the timeline does not record (no `wardic.` prefix)", async () => {
    const timeline = makeTimeline()
    let during = -1
    await Effect.runPromise(
      Effect.sync(() => {
        during = timeline.openCount("app.work")
      }).pipe(Effect.withSpan("app.work"), Effect.provide(timeline.layer)),
    )
    expect(during).toBe(0)
  })

  it("still counts a long-lived span after its record has left the ring", async () => {
    const timeline = makeTimeline({ capacity: 2 })
    const release = Deferred.makeUnsafe<void>()
    const clockFiber = Effect.runFork(
      Deferred.await(release).pipe(Effect.withSpan("wardic.clock"), Effect.provide(timeline.layer)),
    )
    await Promise.resolve()
    expect(timeline.openCount("wardic.clock")).toBe(1)

    // Five newer spans overflow a 2-entry ring: the clock span's record is gone.
    for (let i = 0; i < 5; i++) {
      await Effect.runPromise(Effect.void.pipe(Effect.withSpan("wardic.projection.measure"), Effect.provide(timeline.layer)))
    }
    expect(timeline.window(0, Number.POSITIVE_INFINITY).spans.some((s) => s.name === "wardic.clock")).toBe(false)
    expect(timeline.openCount("wardic.clock")).toBe(1)

    Deferred.doneUnsafe(release, Effect.void)
    await Effect.runPromise(Fiber.await(clockFiber))
    expect(timeline.openCount("wardic.clock")).toBe(0)
  })
})
