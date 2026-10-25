import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it } from "@effect/vitest"

it.effect("Machine.toStream(Machine.animate({ repeat: Infinity })) never auto-terminates", () =>
  Effect.gen(function* () {
    // Arrange — supply ticks that would normally let a single duration:1 leg settle
    // after 4 quarter ticks. With repeat:Infinity, the stream must keep emitting
    // beyond that leg until the consumer (Stream.take) caps it.
    const ticks = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]
    const N = ticks.length

    // Act — cap the otherwise-infinite stream with Stream.take(N). If `animate`
    // auto-terminated at the end of the first leg (4 frames), we'd collect fewer
    // than N frames here.
    // Effect v4: Stream.runCollect returns ReadonlyArray<A> directly (no Chunk wrapper).
    const frames = (yield* Stream.runCollect(
      Machine.toStream(Machine.animate(0, 100, { duration: 1, ease: Easing.linear, repeat: Infinity })).pipe(Stream.take(N)),
    )) as ReadonlyArray<Frame.Frame<number>>

    // Assert — emission count equals N (never settled on its own).
    expect(frames.length).toBe(N)
    // Every emitted frame in an infinite-repeat run carries done:false; termination
    // is the consumer/Clock's job, not the stream's.
    expect(frames.every((f) => f.done === false)).toBe(true)
  }).pipe(Effect.provide(TestClock.layer([0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]))),
)
