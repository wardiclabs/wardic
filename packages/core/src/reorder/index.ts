// The **Reorder group**'s pure pieces (ADR-0020): the Crossover, axis detection, the
// 100 ms direction and Auto-scroll's edge math. Effect-free and DOM-free; the binding
// and the Environment supply the boxes, points and scrollers.
export { AUTO_SCROLL_MAX_SPEED, AUTO_SCROLL_THRESHOLD, type AutoScrollState, autoScrollAxis, autoScrollStep } from "./auto-scroll.ts"
export { checkReorder } from "./check-reorder.ts"
export { detectAxis } from "./detect-axis.ts"
export type { ReorderAxis, ReorderItemData } from "./types.ts"
export { type TimedPoint, trailingVelocity } from "./velocity.ts"
