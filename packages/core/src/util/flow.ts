import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/**
 * Run several animation streams concurrently and complete once they all settle.
 * The streams' values are discarded — use this to orchestrate "play these
 * together" where each stream already drives its own target via a Renderer or
 * `onFrame`. Traced as `wardic.group`.
 */
export const group = <E, R>(...streams: ReadonlyArray<Stream.Stream<unknown, E, R>>): Effect.Effect<void, E, R> =>
  runAll(streams)

/** `group`'s traced body: every stream at once, in the `wardic.group` span. */
const runAll = Effect.fn("wardic.group")(function* <E, R>(streams: ReadonlyArray<Stream.Stream<unknown, E, R>>) {
  yield* Effect.annotateCurrentSpan({ count: streams.length })
  yield* Effect.logDebug("wardic.group: start").pipe(Effect.annotateLogs({ count: streams.length }))
  yield* Effect.forEach(streams, (stream) => Stream.runDrain(stream), { concurrency: "unbounded" })
})

/**
 * Tap each emitted frame for side effects (logging, manual application) without
 * altering the stream. Non-terminal — the stream flows through unchanged. No
 * span here: this is the per-frame hot path.
 */
export const onFrame = <A, E, R>(
  values: Stream.Stream<A, E, R>,
  fn: (value: A) => void,
): Stream.Stream<A, E, R> => values.pipe(Stream.tap((value) => Effect.sync(() => fn(value))))

/**
 * Run a stream to completion and invoke `fn` once it settles. Terminal — returns
 * an Effect that resolves after the final frame. Traced as `wardic.onSettle`.
 */
export const onSettle: <A, E, R>(values: Stream.Stream<A, E, R>, fn: () => void) => Effect.Effect<void, E, R> =
  Effect.fn("wardic.onSettle")(function* <A, E, R>(values: Stream.Stream<A, E, R>, fn: () => void) {
    yield* Stream.runDrain(values)
    yield* Effect.sync(fn)
  })
