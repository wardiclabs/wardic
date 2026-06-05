import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Clock } from "../services/Clock.ts"

/** Instantaneous velocity from two samples and the delta time between them. */
export const velocity = (previous: number, current: number, dt: number): number =>
  dt === 0 ? 0 : (current - previous) / dt

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
            const v = state.previous === undefined ? 0 : velocity(state.previous, current, dt)
            return [{ previous: current }, [v]] as const
          },
        ),
      )
    }),
  )
