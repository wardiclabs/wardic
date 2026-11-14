/**
 * Core's spans (#746, ADR-0067 *Amendment (#746)*, decision 8): opened through what the app gives,
 * `Spans.layer`, read from the fiber where each would open. With nothing given, `none` opens none, and
 * no module an app imports names Effect's `Tracer`. Given, each opens only where something reads it
 * (#460, ADR-0040 *Amendment (#460)*): a tracer installed other than Effect's default, tracing on. No
 * span captures a call-site stack (ADR-0040, decision 2).
 */
import * as Channel from "effect/Channel"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as References from "effect/References"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import type * as Spans from "../Spans.ts"

/** What opens Wardic's spans, read from the fiber where each would open. */
export interface Shape {
  /** `self` under the span `name`, when `fiber` is traced. */
  readonly traced: <A, E, R>(fiber: Fiber.Fiber<unknown, unknown>, self: Effect.Effect<A, E, R>, name: string, options: Spans.Options) => Effect.Effect<A, E, R>
  /** `self` under the span `name` for its Scope's life, when `fiber` is traced. */
  readonly tracedScoped: <A, E, R>(
    fiber: Fiber.Fiber<unknown, unknown>,
    self: Effect.Effect<A, E, R>,
    name: string,
    options: Spans.Options,
  ) => Effect.Effect<A, E, R | Scope.Scope>
  /** `self` under the span `name`, when `fiber`, the one running it, is traced; `self` itself, the same Stream, otherwise. */
  readonly tracedStream: <A, E, R>(fiber: Fiber.Fiber<unknown, unknown>, self: Stream.Stream<A, E, R>, name: string, options: Spans.Options) => Stream.Stream<A, E, R>
  /**
   * `body` under the span `name`, the `ParentSpan` of what runs inside it, with no stack frame
   * (ADR-0040, decision 3), when `fiber` is traced: what a Frame loop run opens. `body` is given the
   * span, or `undefined` with none.
   */
  readonly run: <A, E, R>(
    fiber: Fiber.Fiber<unknown, unknown>,
    name: string,
    attributes: Readonly<Record<string, unknown>>,
    body: (span: Tracer.Span | undefined) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

/** Opens no span: what's read without `Spans.layer`. */
export const none: Shape = {
  traced: (_, self) => self,
  tracedScoped: (_, self) => self,
  tracedStream: (_, self) => self,
  run: (_, __, ___, body) => body(undefined),
}

/**
 * Whether a fiber's spans reach anything: a tracer installed, not Effect's default `nativeTracer` (the
 * comparison Effect's `Tracer` documents for this), and tracing on. With Effect's default, a span is
 * recorded that nothing reads, and its `ParentSpan` gives the fiber a new context root.
 */
const isTraced = (fiber: Fiber.Fiber<unknown, unknown>): boolean =>
  fiber.getRef(Tracer.Tracer) !== Tracer.nativeTracer && fiber.getRef(References.TracerEnabled)

/** Opens each span where its fiber is traced: what `Spans.layer` gives. */
export const opening: Shape = {
  traced: (fiber, self, name, options) => {
    if (!isTraced(fiber)) return self
    return Effect.withSpan(self, name, { ...options, captureStackTrace: false })
  },
  tracedScoped: (fiber, self, name, options) => {
    if (!isTraced(fiber)) return self
    return Effect.withSpanScoped(self, name, { ...options, captureStackTrace: false })
  },
  tracedStream: (fiber, self, name, options) => {
    if (!isTraced(fiber)) return self
    return Stream.withSpan(self, name, { ...options, captureStackTrace: false })
  },
  run: (fiber, name, attributes, body) => {
    if (!isTraced(fiber)) return body(undefined)
    return Effect.useSpan(name, { attributes }, (span) => Effect.provideService(body(span), Tracer.ParentSpan, span))
  },
}

/** What opens Wardic's spans: {@link none} unless the app gives `Spans.layer`, as `FrameLoop`'s metrics are given (#518). */
export const SpansGiven: Context.Reference<Shape> = /*#__PURE__*/ Context.Reference<Shape>("@wardic/core/Spans", { defaultValue: () => none })

/** Whether a tracer reads the running fiber's spans while the app gives none: what development warns of. */
export const missing: Effect.Effect<boolean> = /*#__PURE__*/ Effect.withFiber((fiber) => Effect.succeed(isTraced(fiber) && fiber.getRef(SpansGiven) === none))

/** `self` under the span `name` when its fiber is traced and the app gives spans; as it is otherwise. */
export const traced = <A, E, R>(self: Effect.Effect<A, E, R>, name: string, options: Spans.Options = {}): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => fiber.getRef(SpansGiven).traced(fiber, self, name, options))

/** `self` under the span `name` for its Scope's life when its fiber is traced and the app gives spans; as it is otherwise. */
export const tracedScoped = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  name: string,
  options: Spans.Options = {},
): Effect.Effect<A, E, R | Scope.Scope> => Effect.withFiber((fiber) => fiber.getRef(SpansGiven).tracedScoped(fiber, self, name, options))

/**
 * `self` under the span `name` when the fiber running it is traced and the app gives spans; as it is
 * otherwise. Decided once, when the stream is run, and the pull handed on is `self`'s own: a
 * `Stream.unwrap` here suspended every pull, per element per frame for a Stream consumer (+4–6% on
 * Bun's `ticksOnly`). `Shape.tracedStream` hands `self` back untraced, which is how it's told.
 */
export const tracedStream = <A, E, R>(self: Stream.Stream<A, E, R>, name: string, options: Spans.Options = {}): Stream.Stream<A, E, R> => {
  const channel = Stream.toChannel(self)
  return Stream.fromChannel(
    Channel.fromTransform((upstream, scope) =>
      Effect.withFiber((fiber) => {
        const spanned = fiber.getRef(SpansGiven).tracedStream(fiber, self, name, options)
        if (spanned === self) return Channel.toTransform(channel)(upstream, scope)
        return Channel.toTransform(Stream.toChannel(spanned))(upstream, scope)
      }),
    ),
  )
}
