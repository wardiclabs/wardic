import { InterpolatorRegistryLive, respectReducedMotion, tween } from "@wardic/core"
import { TestClock, TestInput, TestProbe, TestRenderer } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import { References } from "effect"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Stream from "effect/Stream"
import { AtomRegistry } from "effect/unstable/reactivity"

const layerWith = (
  frames: ReadonlyArray<number>,
  prefersReducedMotion: boolean,
) =>
  Layer.mergeAll(
    TestClock.layer(frames),
    TestRenderer.layer,
    TestProbe.layer({ prefersReducedMotion }),
    TestInput.layer(),
    InterpolatorRegistryLive,
    AtomRegistry.layer,
  )

/** Collect all frames from a stream under a fully-configured test layer. */
const collect = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  frames: ReadonlyArray<number>,
  prefersReducedMotion: boolean,
) =>
  Stream.runCollect(stream).pipe(
    Effect.provide(layerWith(frames, prefersReducedMotion)),
  )

interface Captured {
  readonly message: unknown
  readonly annotations: Record<string, unknown>
}

/**
 * Run an effect at Debug level with a logger that captures structured records.
 * The return type is inferred — callers get the real `E`/leftover-`R` rather
 * than an unsafe cast to `Effect<_, never, never>`.
 */
const captureLogs = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  frames: ReadonlyArray<number>,
  prefersReducedMotion: boolean,
) => {
  const records: Array<Captured> = []
  const capture = Logger.map(Logger.formatStructured, (structured) => {
    records.push({ message: structured.message, annotations: structured.annotations })
  })
  return effect.pipe(
    Effect.provide(layerWith(frames, prefersReducedMotion)),
    Effect.provide(Logger.layer([capture])),
    Effect.provideService(References.MinimumLogLevel, "Debug"),
    Effect.map((): ReadonlyArray<Captured> => records),
  )
}

it.effect("snaps to terminal frame when prefersReducedMotion is true", () =>
  Effect.gen(function* () {
    // Frames are sized to drive the underlying tween across its full duration,
    // but the combinator should ignore them and emit only the final value.
    const collected = yield* collect(
      respectReducedMotion(tween(0, 100, { duration: 1 })),
      [0.5, 0.5],
      true,
    )
    expect(collected.length).toBe(1)
    expect(collected[0]).toEqual({ value: 100, done: true })
  }),
)

it.effect("passes the stream through unchanged when prefersReducedMotion is false", () =>
  Effect.gen(function* () {
    const frames = [0.25, 0.25, 0.25, 0.25]
    const unwrapped = yield* collect(tween(0, 100, { duration: 1 }), frames, false)
    const wrapped = yield* collect(respectReducedMotion(tween(0, 100, { duration: 1 })), frames, false)
    expect(wrapped).toEqual(unwrapped)
  }),
)

it.effect("reads the Probe preference once on subscribe (one annotated log, not per-frame)", () =>
  Effect.gen(function* () {
    const records = yield* captureLogs(
      Stream.runDrain(respectReducedMotion(tween(0, 100, { duration: 1 }))),
      [0.5, 0.5],
      false,
    )
    const matching = records.filter((r) => String(r.message).includes("wardic.respectReducedMotion"))
    expect(matching.length).toBe(1)
    expect(matching[0]!.annotations).toMatchObject({ prefersReducedMotion: false })
  }),
)

it.effect("emits an annotated debug log with prefersReducedMotion: true when reduced", () =>
  Effect.gen(function* () {
    const records = yield* captureLogs(
      Stream.runDrain(respectReducedMotion(tween(0, 100, { duration: 1 }))),
      [0.5, 0.5],
      true,
    )
    const matching = records.filter((r) => String(r.message).includes("wardic.respectReducedMotion"))
    expect(matching.length).toBe(1)
    expect(matching[0]!.annotations).toMatchObject({ prefersReducedMotion: true })
  }),
)
