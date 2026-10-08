import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Clock } from "../services/Clock.ts"

/**
 * Wait `seconds` of accumulated clock time, then complete. Built on the same
 * `dt` stream the primitives use, so delays advance with the animation clock
 * rather than wall-clock time. Traced as `wardic.delay`.
 */
export const delay: (seconds: number) => Effect.Effect<void, never, Clock> = Effect.fn("wardic.delay")(
  function* (seconds: number) {
    yield* Effect.annotateCurrentSpan({ seconds })
    yield* Effect.logDebug("wardic.delay: start").pipe(Effect.annotateLogs({ seconds }))
    const clock = yield* Clock
    yield* clock.ticks.pipe(
      Stream.mapAccum(
        () => 0,
        (acc, dt) => {
          const next = acc + dt
          return [next, [next]] as const
        },
      ),
      Stream.takeUntil((elapsed: number) => elapsed >= seconds),
      Stream.runDrain,
    )
  },
)

/**
 * Run `values` until `predicate` holds for an emitted value, then complete
 * (consuming up to and including that value). Useful for "settle, then continue".
 * Traced as `wardic.wait`.
 */
export const wait: <T, E, R>(values: Stream.Stream<T, E, R>, predicate: (value: T) => boolean) => Effect.Effect<void, E, R> =
  Effect.fn("wardic.wait")(function* <T, E, R>(values: Stream.Stream<T, E, R>, predicate: (value: T) => boolean) {
    yield* Effect.logDebug("wardic.wait: start")
    yield* values.pipe(Stream.takeUntil(predicate), Stream.runDrain)
  })
