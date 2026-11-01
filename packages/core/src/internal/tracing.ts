/**
 * Core's spans, opened only where something reads them (#460, ADR-0040 *Amendment (#460)*): a tracer
 * installed other than Effect's default `nativeTracer` (the comparison Effect's `Tracer` documents
 * for this), with `TracerEnabled` on. The devtools, an app's OpenTelemetry exporter and the tests each
 * install one; with Effect's default, a span is recorded that nothing reads, and its `ParentSpan` gives
 * the fiber a new context root. No span captures a call-site stack (ADR-0040, decision 2).
 */
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as References from "effect/References"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"

/** A span's options: Effect's, with no call-site stack. */
export interface SpanOptions {
  readonly attributes?: Record<string, unknown> | undefined
  readonly root?: boolean | undefined
}

/** Whether a fiber's spans reach anything: a tracer installed, not Effect's default, and tracing on. */
export const isTraced = (fiber: Fiber.Fiber<unknown, unknown>): boolean =>
  fiber.getRef(Tracer.Tracer) !== Tracer.nativeTracer && fiber.getRef(References.TracerEnabled)

/** `self` under the span `name` when its fiber is traced; as it is otherwise. */
export const traced = <A, E, R>(self: Effect.Effect<A, E, R>, name: string, options: SpanOptions = {}): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    if (!isTraced(fiber)) return self
    return Effect.withSpan(self, name, { ...options, captureStackTrace: false })
  })

/** `self` under the span `name` for its Scope's life when its fiber is traced; as it is otherwise. */
export const tracedScoped = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  name: string,
  options: SpanOptions = {},
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.withFiber((fiber): Effect.Effect<A, E, R | Scope.Scope> => {
    if (!isTraced(fiber)) return self
    return Effect.withSpanScoped(self, name, { ...options, captureStackTrace: false })
  })

/** `self` under the span `name` when the fiber running it is traced; as it is otherwise. */
export const tracedStream = <A, E, R>(self: Stream.Stream<A, E, R>, name: string, options: SpanOptions = {}): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.withFiber((fiber) => {
      if (!isTraced(fiber)) return Effect.succeed(self)
      return Effect.succeed(Stream.withSpan(self, name, { ...options, captureStackTrace: false }))
    }),
  )
