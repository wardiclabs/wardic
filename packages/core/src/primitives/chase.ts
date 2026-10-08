import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { SpringOptions } from "../options.ts"
import type { Clock } from "../services/Clock.ts"
import { MAX_DT, type PhysicsFrame } from "./frame.ts"
import { type Machine, toStream } from "./machine.ts"
import { initSpring, resolveSpring, stepSpring } from "./stepper.ts"

/**
 * `chase`'s machine (ADR-0027): the spring stepper toward `getTarget()`, read afresh on every
 * step, so a moving target is followed without stale snapshots. Its Frames report rest, but it
 * never settles: a run ends only when it's removed. `spring` runs the same steps, settling.
 */
export const chaseMachine = (getTarget: () => number, options: SpringOptions = {}): Machine<PhysicsFrame> => {
  const spring = resolveSpring(options)
  return {
    settles: false,
    span: { name: "wardic.chase", attributes: { stiffness: spring.stiffness, damping: spring.damping } },
    start: () => {
      let state = initSpring(options)
      // Per frame (ADR-0025): `dt` clamped at the engine boundary, the same jank protection every
      // primitive inherits.
      return (dt) => {
        const result = stepSpring(state, Math.min(dt, MAX_DT), getTarget(), spring)
        state = result.state
        return { value: result.value, velocity: result.velocity, done: result.done }
      }
    },
  }
}

/**
 * Shared dynamic-target spring core.
 *
 * `chaseCore` is the single underlying engine for both `spring` (static target)
 * and `chase` (continuously-moving target): {@link chaseMachine} over `Clock.ticks`,
 * reading the target afresh **per tick** via `getTarget()` so a moving target is
 * followed without stale snapshots.
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
): Stream.Stream<PhysicsFrame, never, Clock> => toStream(chaseMachine(getTarget, options))

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
  const { stiffness, damping } = resolveSpring(options)
  const attributes = { stiffness, damping }
  return Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.chase: subscribe")
      return chaseCore(getTarget, options)
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.chase", { attributes }))
}
