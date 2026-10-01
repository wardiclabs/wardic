import type { Box } from "../layout/box.ts"

/**
 * The axis a **Reorder group** reorders on: a column (`"y"`), a row (`"x"`), or a
 * wrapped grid (`"xy"`). Motion's `ReorderAxis` (Reorder/types.ts at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export type ReorderAxis = "x" | "y" | "xy"

/**
 * One reorderable item as the **Crossover** sees it: its value and its layout box (the
 * slot, not where it paints while dragged). Motion's `ItemData` (Reorder/types.ts at
 * 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface ReorderItemData<V> {
  readonly value: V
  readonly layout: Box
}
