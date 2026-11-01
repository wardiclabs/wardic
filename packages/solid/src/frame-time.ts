/**
 * The time a key's velocity is read against (#464, Motion's `sync-time.ts`): its provider's Clock's
 * `now` (#460, Q7), read once per synchronous block and kept until a microtask clears it, so every
 * sink a tick runs, and a Retarget in the same task, read one time. A browser's is `performance.now()`;
 * a test Environment's, its own advances.
 *
 * @module
 */
import * as Clock from "@wardic/core/Clock"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type { WardicRuntime } from "./runtime.ts"

/**
 * How long a key's velocity holds once nothing has moved it, in ms (Motion's `MAX_VELOCITY_DELTA`):
 * past it, the key is at rest. A velocity worked out from two frames further apart takes this as their
 * time apart.
 */
export const MAX_VELOCITY_DELTA = 30

/** A frame at 60 Hz, in ms: the time a leg's first frame is read over, from where it started (Motion's first-frame delta). */
export const NOMINAL_FRAME = 1000 / 60

/**
 * The time now, in ms: the same for the rest of this synchronous block (core's `Clock.syncNow`).
 * Per frame: a check, and a read once a tick. A Snapshot's time until its spine gives it its
 * provider's ({@link clockNowOf}).
 */
export const frameNow: () => number = Clock.syncNow(() => performance.now())

/** Each runtime's Clock's `now`, read once. */
const clockNows = new WeakMap<WardicRuntime, () => number>()

/**
 * The time a provider's elements read their velocities against (#460, Q7): its Environment's Clock's
 * `now` (#464's sync time in a browser; a test Environment's own advances), kept per runtime.
 */
export const clockNowOf = (runtime: WardicRuntime): (() => number) => {
  const kept = clockNows.get(runtime)
  if (Predicate.isNotUndefined(kept)) return kept
  const read = runtime.runSync(Clock.Clock.use((clock) => Effect.succeed(clock.now)))
  clockNows.set(runtime, read)
  return read
}
