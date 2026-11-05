/**
 * Velocity from samples: `between` for two values a frame apart, and `trailing` for a pointer's last
 * 100 ms, as a drag's release reads it. A value an animation moves carries its own velocity on its
 * frames, so it needs neither.
 *
 * @example
 * import * as Velocity from "@wardic/core/Velocity"
 *
 * const { x, y } = Velocity.trailing(points) // pixels a second, from the pointer's recent points
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import type * as Point from "./Point.ts"

/**
 * The velocity between two samples `dt` seconds apart, in their units a second: `between(10, 16, 1 / 60)`
 * is 360. 0 when `dt` is 0.
 */
export const between = (previous: number, current: number, dt: number): number => {
  if (dt === 0) return 0
  return (current - previous) / dt
}

/** A pointer's position, and when it was there, in milliseconds, as an event's `timeStamp` gives it. */
// Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
export interface TimedPoint {
  readonly x: number
  readonly y: number
  readonly timeStamp: number
}

/**
 * A pointer's velocity over its last `windowMs` (100 by default), in its units a second, from its points
 * oldest first: from the newest point older than the window to the last. A pause before a flick doesn't
 * slow it: when that point is the first, more than twice the window old, and there are more, it starts
 * from the second instead. `{ x: 0, y: 0 }` for fewer than two points. Motion's `getVelocity`, as a
 * drag's release reads it.
 *
 * @example
 * const points: Array<Velocity.TimedPoint> = []
 * // At each move of the pointer:
 * points.push({ x, y, timeStamp })
 * // At its release:
 * fling(Velocity.trailing(points))
 */
// Motion's getVelocity, gestures/pan/PanSession.ts:383-440 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
// ported. DragRecognizer.drag's velocity is this, over each gesture's points (ADR-0004, *Amendment (#139)*).
// Tier 2 (ADR-0008).
export const trailing = (history: ReadonlyArray<TimedPoint>, windowMs = 100): Point.Point =>
  Arr.match(history, {
    onEmpty: still,
    onNonEmpty: (samples) =>
      Bool.match(samples.length < 2, { onTrue: still, onFalse: () => velocityOver(samples, windowMs) }),
  })

/** No motion. */
const still = (): Point.Point => ({ x: 0, y: 0 })

/** Infinity as 0: a step in no time is no velocity. */
const finite = (v: number): number => Bool.match(v === Infinity, { onTrue: () => 0, onFalse: () => v })

/** The trailing velocity of two or more samples (see {@link trailing}). */
const velocityOver = (samples: Arr.NonEmptyReadonlyArray<TimedPoint>, windowMs: number): Point.Point => {
  const last = Arr.lastNonEmpty(samples)
  const age = (sample: TimedPoint): number => last.timeStamp - sample.timeStamp
  // The newest sample older than the window, else the oldest.
  const older = Option.getOrElse(
    Arr.findLast(samples, (sample) => age(sample) > windowMs),
    () => Arr.headNonEmpty(samples),
  )
  // An oldest sample far older than the window is a pause before the move: start from the next.
  const base = Bool.match(Bool.every([older === Arr.headNonEmpty(samples), samples.length > 2, age(older) > windowMs * 2]), {
    onTrue: () => Arr.getUnsafe(samples, 1),
    onFalse: () => older,
  })
  const seconds = (last.timeStamp - base.timeStamp) / 1000
  return Bool.match(seconds === 0, {
    onTrue: still,
    onFalse: () => ({ x: finite((last.x - base.x) / seconds), y: finite((last.y - base.y) / seconds) }),
  })
}
