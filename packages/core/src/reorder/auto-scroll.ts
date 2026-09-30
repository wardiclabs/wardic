import type { Point } from "../math/index.ts"
import type { ReorderAxis } from "./types.ts"

/**
 * How near (px) the pointer must be to a scroller's visible edge for **Auto-scroll**.
 * Motion's `threshold` (Reorder/utils/auto-scroll.ts:1 at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const AUTO_SCROLL_THRESHOLD = 50

/**
 * The most **Auto-scroll** moves a scroller per update (px), at its edge. Motion's
 * `maxSpeed` (Reorder/utils/auto-scroll.ts:2 at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const AUTO_SCROLL_MAX_SPEED = 25

/**
 * The edge **Auto-scroll** is scrolling toward, and the scroll range it had when that
 * edge activated (it never scrolls past it, so content that grows while scrolling
 * doesn't scroll forever).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface AutoScrollState {
  readonly edge: "start" | "end"
  readonly limit: number
}

/**
 * One update of **Auto-scroll** on one axis: how far to scroll the scroller, and the
 * state for the next update. Motion's algorithm (Reorder/utils/auto-scroll.ts at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts),
 * as a pure step.
 *
 * `pointer`, `start` and `end` are viewport px: the scroller's visible edges on the
 * axis, clamped to the viewport by the caller. Within {@link AUTO_SCROLL_THRESHOLD} of
 * an edge it scrolls {@link AUTO_SCROLL_MAX_SPEED} x (1 - distance / threshold)^2
 * toward it (negative toward the start). An edge starts only while the pointer moves
 * toward it (`velocity` on the axis), and records `maxScroll()` then (the only time
 * it's read); once active it keeps scrolling while the pointer stays in the zone, and
 * stops toward the end at that recorded range (`scroll` is the scroller's offset).
 * Outside both zones there is no state.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const autoScrollStep = (
  state: AutoScrollState | undefined,
  input: {
    readonly pointer: number
    readonly start: number
    readonly end: number
    readonly velocity: number
    readonly scroll: number
    readonly maxScroll: () => number
  },
): { readonly amount: number; readonly state: AutoScrollState | undefined } => {
  const fromStart = input.pointer - input.start
  const fromEnd = input.end - input.pointer
  let edge: "start" | "end"
  let amount: number
  if (fromStart < AUTO_SCROLL_THRESHOLD) {
    const intensity = 1 - fromStart / AUTO_SCROLL_THRESHOLD
    edge = "start"
    amount = -AUTO_SCROLL_MAX_SPEED * intensity * intensity
  } else if (fromEnd < AUTO_SCROLL_THRESHOLD) {
    const intensity = 1 - fromEnd / AUTO_SCROLL_THRESHOLD
    edge = "end"
    amount = AUTO_SCROLL_MAX_SPEED * intensity * intensity
  } else {
    return { amount: 0, state: undefined }
  }
  let next = state
  if (next?.edge !== edge) {
    const towardIt = (edge === "start" && input.velocity < 0) || (edge === "end" && input.velocity > 0)
    if (!towardIt) return { amount: 0, state }
    next = { edge, limit: input.maxScroll() }
  }
  if (amount > 0 && input.scroll >= next.limit) return { amount: 0, state: next }
  return { amount, state: next }
}

/**
 * The axis **Auto-scroll** follows: a single-axis group's own, and in a grid the axis
 * the pointer moves faster on (`y` on a tie, as Motion's `>` gives: Reorder/Item.tsx
 * at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const autoScrollAxis = (axis: ReorderAxis, velocity: Point): "x" | "y" =>
  axis === "xy" ? (Math.abs(velocity.x) > Math.abs(velocity.y) ? "x" : "y") : axis
