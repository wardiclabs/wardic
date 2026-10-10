import * as Easing from "@wardic/core/Easing"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Renderer from "@wardic/core/Renderer"
import * as Machine from "@wardic/core/Machine"
import { TestClock, TestRenderer } from "@wardic/test"
import { References } from "effect"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Stream from "effect/Stream"
import { expect, it } from "@effect/vitest"

interface Captured {
  readonly message: unknown
  readonly annotations: Record<string, unknown>
}

/** Build a Renderer Layer backed by a fresh recording instance, plus return the recording. */
const makeRecording = (): {
  readonly recording: ReturnType<typeof TestRenderer.makeRecordingRenderer>
  readonly layer: Layer.Layer<Renderer.Renderer>
} => {
  const recording = TestRenderer.makeRecordingRenderer()
  return {
    recording,
    layer: Layer.succeed(Renderer.Renderer, recording.service),
  }
}

it.effect("applyTo drives every frame through project then commit, with the final commit landing on the target values", () => {
  // Arrange — a four-frame quarter tween from { x: 0, opacity: 0 } to { x: 100, opacity: 1 }.
  // The recording renderer captures every project and commit call separately, so we can
  // assert the two halves of the imperative path stay in lockstep.
  // `recording` is captured in the test body scope before the Effect runs so assertions
  // can read its state after the Effect completes.
  const quarter = [0.25, 0.25, 0.25, 0.25]
  const { recording, layer: rendererLayer } = makeRecording()
  const target = { node: "el" }

  return Effect.gen(function* () {
    // Act — run applyTo, providing the recording Renderer, a deterministic Clock, and
    // the live InterpolatorRegistry that `animateValues` needs.
    yield* Renderer.applyTo(
      Machine.animateValues({ x: 0, opacity: 0 }, { x: 100, opacity: 1 }, { duration: 1, easing: Easing.linear }).pipe(
        Effect.map(Machine.toStream),
        Stream.unwrap,
      ),
      target,
    ).pipe(
      Effect.provide(rendererLayer),
      Effect.provide(TestClock.layer(quarter)),
      Effect.provide(InterpolatorRegistry.layer),
    )

    // Assert — four ticks produce four project calls and four commit calls; counts match.
    expect(recording.projectCalls.length).toBe(4)
    expect(recording.commitCalls.length).toBe(4)
    expect(recording.projectCalls.length).toBe(recording.commitCalls.length)

    // The final commit's patch must equal the tween's target values (linear, quarters → lands at 1.0).
    expect(recording.commitCalls.at(-1)?.patch).toEqual({ x: 100, opacity: 1 })

    // Each commit received the same opaque target reference we passed in.
    for (const call of recording.commitCalls) {
      expect(call.target).toBe(target)
    }
  })
})

it.effect("applyTo emits exactly one annotated `wardic.applyTo: subscribe` debug log per run (not per frame)", () => {
  // Arrange — capture structured log records at Debug level while applyTo drains the stream.
  // `records` is captured in the test body scope and read after the Effect completes.
  const quarter = [0.25, 0.25, 0.25, 0.25]
  const { layer: rendererLayer } = makeRecording()
  const records: Array<Captured> = []
  const capture = Logger.map(Logger.formatStructured, (structured) => {
    records.push({ message: structured.message, annotations: structured.annotations })
  })

  return Effect.gen(function* () {
    // Act — run applyTo over the same four-frame setup with the capturing logger installed.
    // The stream first: `stream.pipe(Renderer.applyTo(target))` (ADR-0028, decision 12).
    yield* Machine.animateValues({ x: 0, opacity: 0 }, { x: 100, opacity: 1 }, { duration: 1, easing: Easing.linear }).pipe(
      Effect.map(Machine.toStream),
      Stream.unwrap,
      Renderer.applyTo({ node: "el" }),
    ).pipe(
      Effect.provide(rendererLayer),
      Effect.provide(TestClock.layer(quarter)),
      Effect.provide(InterpolatorRegistry.layer),
      Effect.provide(Logger.layer([capture])),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
    )

    // Assert — the subscribe log appears exactly once across all four ticks.
    const matching = records.filter((r) => String(r.message).includes("wardic.applyTo: subscribe"))
    expect(matching.length).toBe(1)
    expect(matching[0]!.annotations).toMatchObject({ target: "object" })
  })
})
