import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import { traced, tracedScoped, tracedStream } from "../src/internal/tracing.ts"
import * as Spans from "../src/Spans.ts"

/**
 * A Stream's span, opened only where something reads it (#460, ADR-0040 *Amendment (#460)*): decided
 * once per run, the elements passed on either way. And only where the app gives Wardic's spans,
 * `Spans.layer` (#746, ADR-0067 *Amendment (#746)*, decision 8):
 *
 * - SP1: with a tracer but no `Spans.layer`, a traced Stream, Effect and scoped Effect open no span.
 * - SP2: with both, each opens its span.
 */

/** A tracer that records each span's name, then opens it as Effect's default does. */
const recording = (names: Array<string>): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      names.push(options.name)
      return Tracer.nativeTracer.span(options)
    },
  })

const stream = tracedStream(Stream.make(1, 2, 3), "test.stream")

describe("tracedStream (#460)", () => {
  it.effect("opens its span under an installed tracer", () =>
    Effect.gen(function* () {
      const names: Array<string> = []
      const out = yield* Stream.runCollect(stream).pipe(Effect.withTracer(recording(names)), Effect.provide(Spans.layer))
      expect(out).toEqual([1, 2, 3])
      expect(names).toEqual(["test.stream"])
    }),
  )

  it.effect("opens none with tracing off", () =>
    Effect.gen(function* () {
      const names: Array<string> = []
      const out = yield* Stream.runCollect(stream).pipe(Effect.withTracerEnabled(false), Effect.withTracer(recording(names)), Effect.provide(Spans.layer))
      expect(out).toEqual([1, 2, 3])
      expect(names).toEqual([])
    }),
  )

  it.effect("passes every element on under Effect's default tracer", () =>
    Effect.gen(function* () {
      expect(yield* Stream.runCollect(stream)).toEqual([1, 2, 3])
    }),
  )
})

describe("Spans (#746)", () => {
  it.effect("SP1: with a tracer but no Spans.layer, a traced Stream, Effect and scoped Effect open no span", () =>
    Effect.gen(function* () {
      const names: Array<string> = []
      expect(yield* Stream.runCollect(stream).pipe(Effect.withTracer(recording(names)))).toEqual([1, 2, 3])
      expect(yield* traced(Effect.succeed(1), "test.effect").pipe(Effect.withTracer(recording(names)))).toBe(1)
      expect(yield* Effect.scoped(tracedScoped(Effect.succeed(2), "test.scoped")).pipe(Effect.withTracer(recording(names)))).toBe(2)
      expect(names).toEqual([])
    }),
  )

  it.effect("SP2: with Spans.layer and a tracer, each opens its span", () =>
    Effect.gen(function* () {
      const names: Array<string> = []
      expect(yield* Stream.runCollect(stream).pipe(Effect.withTracer(recording(names)), Effect.provide(Spans.layer))).toEqual([1, 2, 3])
      expect(yield* traced(Effect.succeed(1), "test.effect").pipe(Effect.withTracer(recording(names)), Effect.provide(Spans.layer))).toBe(1)
      expect(yield* Effect.scoped(tracedScoped(Effect.succeed(2), "test.scoped")).pipe(Effect.withTracer(recording(names)), Effect.provide(Spans.layer))).toBe(2)
      expect(names).toEqual(["test.stream", "test.effect", "test.scoped"])
    }),
  )
})

