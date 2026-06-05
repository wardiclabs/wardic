import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { SpringOptions } from "../options.ts"
import { Clock } from "../services/Clock.ts"
import { MAX_DT, type PhysicsFrame } from "./frame.ts"
import { initSpring, springStep } from "./stepper.ts"

/**
 * Shared dynamic-target spring core.
 *
 * `chaseCore` is the single underlying engine for both `spring` (static target)
 * and `chase` (continuously-moving target). It integrates the spring stepper
 * over `Clock.ticks`, reading the target afresh **per tick** via `getTarget()`
 * so a moving target is followed without stale snapshots.
 *
 * The core itself emits indefinitely — it never terminates on its own. Each
 * primitive layered on top decides when to stop:
 *   - `spring` snaps termination via `Stream.takeUntil((f) => f.done)`, so a
 *     static target completes on settle.
 *   - `chase` leaves the stream open, so motion only ends when the consumer
 *     cancels the scope.
 *
 * Observability lives at the call sites (`spring`/`chase`); `chaseCore` itself
 * is a plumbing primitive and does not own a span.
 */
export const chaseCore = (
  getTarget: () => number,
  options: SpringOptions = {},
): Stream.Stream<PhysicsFrame, never, Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock
      return clock.ticks.pipe(
        Stream.mapAccum(
          () => initSpring(options),
          (state, dt) => {
            // Clamp at the engine boundary — same jank protection every primitive inherits.
            const clampedDt = dt > MAX_DT ? MAX_DT : dt
            const result = springStep(state, clampedDt, getTarget(), options)
            const frame: PhysicsFrame = {
              value: result.value,
              velocity: result.velocity,
              done: result.done,
            }
            return [result.state, [frame]] as const
          },
        ),
      )
    }),
  )

/**
 * Physics primitive that follows a continuously-moving target indefinitely.
 *
 * Unlike `spring`, `chase` never auto-settles: even when the spring would reach
 * its rest thresholds, the stream keeps emitting per-tick frames as long as the
 * consumer holds the subscription. `getTarget()` is evaluated every tick, so
 * the chase tracks a target that keeps moving (cursor follower, scroll-linked
 * UI, retargeted snap, etc.).
 *
 * Termination is the consumer's responsibility — cancel the scope (or close the
 * surrounding component) to end the run.
 */
export const chase = (
  getTarget: () => number,
  options: SpringOptions = {},
): Stream.Stream<PhysicsFrame, never, Clock> => {
  const attributes = {
    stiffness: options.stiffness ?? 170,
    damping: options.damping ?? 26,
  }
  return Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.chase: subscribe")
      return chaseCore(getTarget, options)
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.chase", { attributes }))
}
