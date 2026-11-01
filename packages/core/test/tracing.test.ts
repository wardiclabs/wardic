import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import { tracedStream } from "../src/internal/tracing.ts"

/**
 * A Stream's span, opened only where something reads it (#460, ADR-0040 *Amendment (#460)*): decided
 * once per run, the elements passed on either way.
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
      const out = yield* Stream.runCollect(stream).pipe(Effect.withTracer(recording(names)))
      expect(out).toEqual([1, 2, 3])
      expect(names).toEqual(["test.stream"])
    }),
  )

  it.effect("opens none with tracing off", () =>
    Effect.gen(function* () {
      const names: Array<string> = []
      const out = yield* Stream.runCollect(stream).pipe(Effect.withTracerEnabled(false), Effect.withTracer(recording(names)))
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
