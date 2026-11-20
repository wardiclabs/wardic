/**
 * The time a key's velocity is read against (#464, Motion's `sync-time.ts`): its provider's Clock's
 * `now` (#460, Q7), read once per synchronous block and kept until a microtask clears it, so every
 * sink a tick runs, and a Retarget in the same task, read one time: an Environment's own (`@wardic/dom`'s
 * reads its runtime's clock; a test Environment's advances as its test says).
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: solid's `frame-time.ts`, moved for the spine to read its
// Clock's time in core; its WeakMap keyed by the Runner since PR 1 (the move plan's *Built in PR 1*).
import * as Clock from "../Clock.ts"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as WardicServices from "./WardicServices.ts"

/**
 * How long a key's velocity holds once nothing has moved it, in ms (Motion's `MAX_VELOCITY_DELTA`):
 * past it, the key is at rest. A velocity worked out over a longer step takes this as the step's time.
 */
export const MAX_VELOCITY_DELTA = 30

// #672: declared here, as core's `Clock.ts` declares it, since core builds with no DOM in its lib.
declare const performance: { readonly now: () => number }

/**
 * The time now, in ms: the same for the rest of this synchronous block (core's `Clock.syncNow`).
 * Per frame: a check, and a read once a tick. A Snapshot's time until its spine gives it its
 * provider's ({@link clockNowOf}).
 */
export const frameNow: () => number = Clock.syncNow(() => performance.now())

/** Each runtime's Clock's `now`, read once. */
// Module state (#460, Q7): each runtime's clock, held weakly by the runtime.
const clockNows = new WeakMap<WardicServices.Runner<WardicServices.WardicServices>, () => number>()

/**
 * The time a provider's elements read their velocities against (#460, Q7): its Environment's Clock's
 * `now` (#464's sync time, `@wardic/dom`'s or a test Environment's own), kept per runtime.
 */
export const clockNowOf = (runtime: WardicServices.Runner<WardicServices.WardicServices>): (() => number) => {
  const kept = clockNows.get(runtime)
  if (Predicate.isNotUndefined(kept)) return kept
  const read = runtime.runSync(Clock.Clock.use((clock) => Effect.succeed(clock.now)))
  clockNows.set(runtime, read)
  return read
}
