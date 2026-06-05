import { animate, animateValues, decay, type Frame, isPhysicsFrame, linear, spring, tween } from "@wardic/core"
import { testLayer, TestClock } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it } from "@effect/vitest"

/** Extract `.value` from each `Frame<V>` in a collected sequence. */
const values = <V>(frames: ReadonlyArray<Frame<V>>): ReadonlyArray<V> => frames.map((f) => f.value)

const quarter = [0.25, 0.25, 0.25, 0.25]

it.effect("tween emits eased progress and lands exactly on the target", () =>
  Effect.gen(function* () {
    const frames = yield* Stream.runCollect(tween(0, 100, { duration: 1, easing: linear })).pipe(
      Effect.provide(TestClock.layer(quarter)),
    )
    expect(values(frames)).toEqual([25, 50, 75, 100])
    expect(frames.at(-1)?.done).toBe(true)
  }),
)

it.effect("tween clamps and completes even if frames overshoot the duration", () =>
  Effect.gen(function* () {
    const frames = yield* Stream.runCollect(tween(0, 10, { duration: 0.5 })).pipe(
      Effect.provide(TestClock.layer([0.25, 0.25, 0.25, 0.25])),
    )
    // settles at 0.5s (frame 2); takeUntil stops there inclusively.
    expect(values(frames)).toEqual([5, 10])
    expect(frames.at(-1)?.done).toBe(true)
  }),
)

it.effect("animate honors reverse", () =>
  Effect.gen(function* () {
    const frames = yield* Stream.runCollect(
      animate(0, 100, { duration: 1, easing: linear, reverse: true }),
    ).pipe(Effect.provide(TestClock.layer(quarter)))
    expect(values(frames)).toEqual([75, 50, 25, 0])
    expect(frames.at(-1)?.done).toBe(true)
  }),
)

it.effect("animate repeats", () =>
  Effect.gen(function* () {
    const frames = yield* Stream.runCollect(
      animate(0, 10, { duration: 1, easing: linear, repeat: 1 }),
    ).pipe(Effect.provide(TestClock.layer([...quarter, ...quarter])))
    expect(values(frames)).toEqual([2.5, 5, 7.5, 10, 2.5, 5, 7.5, 10])
    expect(frames.at(-1)?.done).toBe(true)
  }),
)

it.effect("spring settles exactly on the target and stops early", () =>
  Effect.gen(function* () {
    const ticks = TestClock.frames(240, 1 / 60) // up to 4s
    const frames = yield* Stream.runCollect(spring(100, { from: 0, stiffness: 170, damping: 26 })).pipe(
      Effect.provide(TestClock.layer(ticks)),
    )
    expect(frames.at(-1)?.value).toBe(100) // snapped to target on settle
    expect(frames.at(-1)?.done).toBe(true)
    expect(frames.length).toBeLessThan(ticks.length) // stopped before frames ran out
    expect(frames[0]!.value).toBeGreaterThan(0) // moved on the first frame
  }),
)

it.effect("isPhysicsFrame narrows spring output and exposes finite velocity", () =>
  Effect.gen(function* () {
    // Arrange — a short spring run we know will emit at least one frame.
    const ticks = TestClock.frames(60, 1 / 60)

    // Act — collect spring frames and pull the first one.
    const frames = yield* Stream.runCollect(spring(100, { from: 0, stiffness: 170, damping: 26 })).pipe(
      Effect.provide(TestClock.layer(ticks)),
    )
    const first = frames[0]!

    // Assert — the type guard narrows to PhysicsFrame and velocity is a finite number.
    expect(isPhysicsFrame(first)).toBe(true)
    if (!isPhysicsFrame(first)) throw new Error("expected PhysicsFrame")
    expect(Number.isFinite(first.velocity)).toBe(true)
  }),
)

it.effect("decay slows to a stop and only ever moves forward", () =>
  Effect.gen(function* () {
    const ticks = TestClock.frames(180, 1 / 60)
    const frames = yield* Stream.runCollect(decay(0, 100, { friction: 5 })).pipe(
      Effect.provide(TestClock.layer(ticks)),
    )
    const vs = values(frames)
    expect(frames.length).toBeLessThan(ticks.length) // reached rest
    expect(frames.at(-1)?.done).toBe(true)
    for (let i = 1; i < vs.length; i++) {
      expect(vs[i]!).toBeGreaterThanOrEqual(vs[i - 1]!) // monotonic for +velocity
    }
    expect(vs.at(-1)!).toBeGreaterThan(15) // traveled a sensible distance
  }),
)

it.effect("animateValues interpolates each key through the registry in lockstep", () =>
  Effect.gen(function* () {
    const frames = yield* Stream.runCollect(
      animateValues({ x: 0, opacity: 0 }, { x: 100, opacity: 1 }, { duration: 1, easing: linear }),
    ).pipe(Effect.provide(testLayer(quarter))) // provides Clock + InterpolatorRegistry
    expect(frames.at(-1)?.value).toEqual({ x: 100, opacity: 1 })
    expect(frames.at(-1)?.done).toBe(true)
    expect(frames[0]?.value).toEqual({ x: 25, opacity: 0.25 })
  }),
)

it.effect("animateValues honors reverse and repeat (modifiers propagate through multi)", () =>
  Effect.gen(function* () {
    // Arrange — one full forward leg followed by one repeat, with reverse flipping endpoints.
    // reverse swaps from/to, so the stream goes 1 -> 0 across one leg, then repeats 1 -> 0.
    const ticks = [...quarter, ...quarter]

    // Act — drive animateValues through testLayer (Clock + InterpolatorRegistry).
    const frames = yield* Stream.runCollect(
      animateValues(
        { x: 0, opacity: 0 },
        { x: 100, opacity: 1 },
        { duration: 1, easing: linear, reverse: true, repeat: 1 },
      ),
    ).pipe(Effect.provide(testLayer(ticks)))

    // Assert — final lands on the (reversed) endpoint, first leg ends with done:false,
    // overall frame count matches the supplied ticks (two legs × 4 frames).
    expect(frames.length).toBe(ticks.length)
    expect(frames.at(-1)?.value).toEqual({ x: 0, opacity: 0 })
    expect(frames.at(-1)?.done).toBe(true)
    // The mid-stream "end of first leg" frame must NOT be the terminal done frame.
    expect(frames[3]?.done).toBe(false)
    // First frame of the reversed leg interpolates 1 -> 0 by 25%.
    expect(frames[0]?.value).toEqual({ x: 75, opacity: 0.75 })
  }),
)
