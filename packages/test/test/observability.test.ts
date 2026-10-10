import * as Easing from "@wardic/core/Easing"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Renderer from "@wardic/core/Renderer"
import * as Machine from "@wardic/core/Machine"
import { TestClock, TestRenderer } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import { References } from "effect"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"

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
) => {
  const records: Array<Captured> = []
  const capture = Logger.map(Logger.formatStructured, (structured) => {
    records.push({ message: structured.message, annotations: structured.annotations })
  })
  return effect.pipe(
    Effect.provide(TestClock.layer(frames)),
    Effect.provide(Logger.layer([capture])),
    Effect.provideService(References.MinimumLogLevel, "Debug"),
    Effect.map((): ReadonlyArray<Captured> => records),
  )
}

it.effect("tween emits an annotated debug log on subscribe (and its span executes)", () =>
  Effect.gen(function* () {
    const records = yield* captureLogs(Stream.runDrain(Machine.toStream(Machine.tween(0, 10, { duration: 1 }))), [0.5, 0.5])
    const log = records.find((r) => String(r.message).includes("wardic.tween"))
    expect(log).toBeDefined()
    expect(log!.annotations).toMatchObject({ from: 0, to: 10, duration: 1 })
  }),
)

it.effect("animate subscribes once, as wardic.animate: its segments are one run, not a tween Stream each (#94)", () =>
  Effect.gen(function* () {
    const records = yield* captureLogs(
      Stream.runDrain(Machine.toStream(Machine.animate(0, 100, { duration: 1, repeat: 1 }))),
      [0.5, 0.5, 0.5, 0.5],
    )
    const subscribes = records.filter((r) => String(r.message).endsWith(": subscribe"))
    expect(subscribes.map((r) => r.message)).toEqual(["wardic.animate: subscribe"])
    expect(subscribes[0]!.annotations).toMatchObject({ from: 0, to: 100, repeat: 1 })
  }),
)

it.effect("animate's Stream is one span, wardic.animate, where it nested a wardic.tween per segment (#94)", () =>
  Effect.gen(function* () {
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      },
    })
    yield* Stream.runDrain(Machine.toStream(Machine.animate(0, 100, { duration: 1, repeat: 1 }))).pipe(
      Effect.provide(TestClock.layer([0.5, 0.5, 0.5, 0.5])),
      Effect.provideService(Tracer.Tracer, tracer),
    )
    expect(spans.map((span) => span.name)).toEqual(["wardic.animate"])
    expect(Object.fromEntries(spans[0]!.attributes)).toEqual({ from: 0, to: 100, repeat: 1, yoyo: false, reverse: false })
    expect(spans[0]!.status._tag).toBe("Ended")
  }),
)

it.effect("applyTo emits the `wardic.applyTo: subscribe` debug log and routes frames through project + commit", () =>
  Effect.gen(function* () {
    // Arrange — capture log records while running applyTo against a recording Renderer.
    // This replaces the older `apply`-keyed assertions: under the split contract
    // (ADR 0002) observability is anchored on the `applyTo` span plus the project/commit
    // pair surfaced by the Renderer service.
    const recording = TestRenderer.makeRecordingRenderer()
    const records: Array<Captured> = []
    const capture = Logger.map(Logger.formatStructured, (structured) => {
      records.push({ message: structured.message, annotations: structured.annotations })
    })

    // Act — drive a 4-frame tween into a no-op target, capturing both calls and logs.
    yield* Renderer.applyTo(
      Machine.animateValues({ x: 0 }, { x: 10 }, { duration: 1, easing: Easing.linear }).pipe(
        Effect.map(Machine.toStream),
        Stream.unwrap,
      ),
      { node: "el" },
    ).pipe(
      Effect.provide(Layer.succeed(Renderer.Renderer, recording.service)),
      Effect.provide(TestClock.layer([0.25, 0.25, 0.25, 0.25])),
      Effect.provide(InterpolatorRegistry.layer),
      Effect.provide(Logger.layer([capture])),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
    )

    // Assert — the applyTo subscribe log appears and the project/commit halves both ran per frame.
    const subscribeLogs = records.filter((r) => String(r.message).includes("wardic.applyTo: subscribe"))
    expect(subscribeLogs.length).toBe(1)
    expect(recording.projectCalls.length).toBe(4)
    expect(recording.commitCalls.length).toBe(4)
  }),
)
