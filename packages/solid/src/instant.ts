/**
 * The **Instant change** and the **Projection reset** (#443, Motion's `useInstantLayoutTransition`,
 * `useInstantTransition` and `useResetProjection`), scoped to a provider's runtime: its projection
 * system's `instant` and `reset`, and a flag its elements' animations read as they start.
 *
 * Solid-free: both bindings run it over their own provider's context value (#209).
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { constFalse, constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"

/**
 * Whether a provider's animations are instant now (#443, Motion's `instantAnimations`): while on,
 * every animation that starts is a **Skipped animation** (#468). `start` turns it on, and it goes off
 * two Refresh frames after the last `start`, as Motion's does; `end` turns it off at once (Motion's
 * `disableInstantTransitions`).
 */
export interface InstantAnimations {
  readonly active: () => boolean
  readonly start: () => void
  readonly end: () => void
}

/** A provider's {@link InstantAnimations}, timed by its Environment's Refresh frames, found at the first `start`. */
export const makeInstantAnimations = (requestFrame: () => (callback: () => void) => unknown): InstantAnimations => {
  let on = false
  // The calls so far: a call's turn-off is skipped once a later call has come.
  let calls = 0
  return {
    active: () => on,
    start: () => {
      on = true
      calls++
      const call = calls
      const request = requestFrame()
      request(() =>
        request(() => {
          if (call === calls) on = false
        }))
    },
    end: () => {
      on = false
    },
  }
}

/** A server's: never on. */
export const NO_INSTANT: InstantAnimations = { active: constFalse, start: constVoid, end: constVoid }

/**
 * `createInstantTransition()`'s start: `start(fn)` runs `fn`, and its layout change and every
 * animation that starts until two frames after the call land at once. A later call extends it, and
 * `start.end()` ends it now.
 */
// #443, Motion's `useInstantTransition`; `end` is its `disableInstantTransitions`.
export interface InstantTransition {
  (fn: () => void): void
  readonly end: () => void
}

/**
 * An Instant change of the layout (#443): `fn` run, and the next Measure pass blocked. On a server,
 * with no projection system, `fn` alone.
 */
export const instantLayoutOf =
  (projection: () => ProjectionSystem.Shape | undefined) =>
  (fn?: () => void): void => {
    const system = projection()
    if (Predicate.isNotUndefined(system)) return system.instant(fn)
    if (Predicate.isNotUndefined(fn)) fn()
  }

/** An Instant change of the layout and of the animations started meanwhile (#443): see {@link InstantTransition}. */
export const instantTransitionOf = (projection: () => ProjectionSystem.Shape | undefined, instant: () => InstantAnimations): InstantTransition =>
  Object.assign(
    (fn: () => void): void =>
      instantLayoutOf(projection)(() => {
        instant().start()
        fn()
      }),
    { end: () => instant().end() },
  )

/** A Projection reset (#443): the projection system's `reset`; nothing on a server. */
export const resetOf = (projection: () => ProjectionSystem.Shape | undefined) => (): void => {
  const system = projection()
  if (Predicate.isNotUndefined(system)) system.reset()
}
