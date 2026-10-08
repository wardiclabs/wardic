import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import type { Point } from "../math/index.ts"

/**
 * A pointer position at a time (ms, the event's `timeStamp`).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface TimedPoint {
  readonly x: number
  readonly y: number
  readonly timeStamp: number
}

/**
 * The velocity (units/s) over the trailing `windowMs` of `history`, oldest first: from
 * the newest point more than `windowMs` older than the last one (or the oldest point)
 * to the last. When that is the first point, there are more than two, and it's more
 * than twice the window old, the second point is used instead, so a hold before a
 * flick doesn't dilute it. Motion's `getVelocity` (gestures/pan/PanSession.ts:383-440
 * at 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L383-L440),
 * ported; a **Reorder group** takes its drag direction from it. Core `drag`'s own
 * velocity keeps its 30 ms window.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const trailingVelocity = (history: ReadonlyArray<TimedPoint>, windowMs = 100): Point =>
  Arr.match(history, {
    onEmpty: still,
    onNonEmpty: (samples) =>
      Bool.match(samples.length < 2, { onTrue: still, onFalse: () => velocityOver(samples, windowMs) }),
  })

/** No motion. */
const still = (): Point => ({ x: 0, y: 0 })

/** Infinity as 0: a step in no time is no velocity. */
const finite = (v: number): number => Bool.match(v === Infinity, { onTrue: () => 0, onFalse: () => v })

/** The trailing velocity of two or more samples (see {@link trailingVelocity}). */
const velocityOver = (samples: Arr.NonEmptyReadonlyArray<TimedPoint>, windowMs: number): Point => {
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
