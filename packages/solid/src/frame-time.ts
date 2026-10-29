/**
 * The time a key's velocity is read against (#464, Motion's `sync-time.ts`): `performance.now()`, read
 * once per synchronous block and kept until a microtask clears it, so every sink a tick runs, and a
 * Retarget in the same task, read one time.
 *
 * @module
 */
import * as Predicate from "effect/Predicate"

/**
 * How long a key's velocity holds once nothing has moved it, in ms (Motion's `MAX_VELOCITY_DELTA`):
 * past it, the key is at rest. A velocity worked out from two frames further apart takes this as their
 * time apart.
 */
export const MAX_VELOCITY_DELTA = 30

/** A frame at 60 Hz, in ms: the time a leg's first frame is read over, from where it started (Motion's first-frame delta). */
export const NOMINAL_FRAME = 1000 / 60

/** The time this block read, until the microtask that clears it. */
let now: number | undefined

const clear = (): void => {
  now = undefined
}

/** The time now, in ms: the same for the rest of this synchronous block. Per frame: a check, and a read once a tick. */
export const frameNow = (): number => {
  if (Predicate.isNotUndefined(now)) return now
  const read = performance.now()
  now = read
  queueMicrotask(clear)
  return read
}
