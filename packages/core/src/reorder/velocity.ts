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
export const trailingVelocity = (history: ReadonlyArray<TimedPoint>, windowMs = 100): Point => {
  if (history.length < 2) return { x: 0, y: 0 }
  const last = history[history.length - 1]!
  let i = history.length - 1
  let base: TimedPoint | undefined
  while (i >= 0) {
    base = history[i]!
    if (last.timeStamp - base.timeStamp > windowMs) break
    i--
  }
  if (base === undefined) return { x: 0, y: 0 }
  if (base === history[0] && history.length > 2 && last.timeStamp - base.timeStamp > windowMs * 2) base = history[1]!
  const seconds = (last.timeStamp - base.timeStamp) / 1000
  if (seconds === 0) return { x: 0, y: 0 }
  const x = (last.x - base.x) / seconds
  const y = (last.y - base.y) / seconds
  return { x: x === Infinity ? 0 : x, y: y === Infinity ? 0 : y }
}
