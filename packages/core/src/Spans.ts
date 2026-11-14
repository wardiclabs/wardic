/**
 * Wardic's spans, an app's to give: with {@link layer} and a tracer installed (the devtools', an
 * OpenTelemetry exporter's), each animation runs in a span named for what it is, and each burst of
 * frames, gesture, layout pass and exit in one of its own. Without `layer`, Wardic opens none, and an
 * app ships none of their code. With `layer` and no tracer, it opens none either.
 *
 * @example
 * const env = Layer.mergeAll(DomLive, devtools, Spans.layer)
 *
 * @module
 */
// #746, ADR-0067 *Amendment (#746)*, decision 8: the span code was every app's, a tracer or not (Effect
// 4.1.4's runtime no longer keeps `Tracer` and `Hex`; opening a span brings them). What opens them is a
// Reference in `internal/tracing.ts`, as `FrameLoop`'s metrics are given (#518): its default opens none.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { dual } from "./internal/dual.ts"
import * as internal from "./internal/tracing.ts"

/** A span's options: its attributes, and whether it's a root, with no parent. */
export interface Options {
  readonly attributes?: Readonly<Record<string, unknown>> | undefined
  readonly root?: boolean | undefined
}

/**
 * Wardic's spans, given: merged beside an Environment, each animation, burst of frames, gesture,
 * layout pass and exit opens its span under the tracer installed. `@wardic/dom` gives it as
 * `WardicSpans`.
 */
export const layer: Layer.Layer<never> = /*#__PURE__*/ Layer.succeed(internal.SpansGiven, internal.opening)

/**
 * `self` under the span `name`, opened as Wardic's own are: when the app gives {@link layer} and a
 * tracer reads it, with no call-site stack. As it is otherwise. For a binding's own spans.
 *
 * @example
 * const measured = pass.pipe(Spans.withSpan("app.measure", { attributes: { nodes: 3 } }))
 */
// `dual` as `Effect.withSpan` is, told apart by its first argument.
export const withSpan: {
  (name: string, options?: Options): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, name: string, options?: Options): Effect.Effect<A, E, R>
} = /*#__PURE__*/ dual(Effect.isEffect, internal.traced)

/**
 * Whether a tracer reads the running fiber's spans while the app gives no {@link layer}: what a
 * binding warns of in development, as it builds its Environment.
 */
export const missing: Effect.Effect<boolean> = internal.missing
