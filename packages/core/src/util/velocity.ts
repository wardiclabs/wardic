import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import { Clock } from "../services/Clock.ts"

/** Instantaneous velocity from two samples and the delta time between them. */
export const velocity = (previous: number, current: number, dt: number): number => {
  if (dt === 0) return 0
  return (current - previous) / dt
}

/** The velocity since `previous`, or 0 at the first tick, which has none. Per frame: an early return. */
const velocitySince = (previous: number | undefined, current: number, dt: number): number => {
  if (Predicate.isUndefined(previous)) return 0
  return velocity(previous, current, dt)
}

/**
 * Transform a value stream into a velocity stream sourced from the engine
 * `Clock`. Each emitted value is paired with the `dt` of the frame it was
 * produced on, so velocities reflect the real elapsed time (variable frame
 * times supported). The first frame reports `0` (no previous sample yet).
 *
 * For ad-hoc, non-Clock contexts the standalone {@link velocity} helper remains
 * available.
 */
export const velocityOf = <E, R>(
  values: Stream.Stream<number, E, R>,
): Stream.Stream<number, E, R | Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock
      return Stream.zipWith(values, clock.ticks, (current, dt) => [current, dt] as const).pipe(
        Stream.mapAccum(
          (): { previous: number | undefined } => ({ previous: undefined }),
          (state, [current, dt]) => {
            const v = velocitySince(state.previous, current, dt)
            return [{ previous: current }, [v]] as const
          },
        ),
      )
    }),
  )
