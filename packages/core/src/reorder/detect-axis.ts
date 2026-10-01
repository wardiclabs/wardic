import type { Axis, Box } from "../layout/box.ts"
import type { ReorderAxis } from "./types.ts"

const isSeparated = (a: Axis, b: Axis): boolean => a.max <= b.min || b.max <= a.min

/**
 * The axis a set of item boxes is laid out on: `"x"` if some pair doesn't overlap
 * horizontally, `"y"` if some pair doesn't overlap vertically, `"xy"` if both (a
 * wrapped grid), and `"y"` otherwise. It compares pairs and stops once both are
 * found. Motion's `detectAxis` (Reorder/utils/detect-axis.ts at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/detect-axis.ts),
 * ported.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const detectAxis = (layouts: ReadonlyArray<Box>): ReorderAxis => {
  let x = false
  let y = false
  for (let i = 0; i < layouts.length; i++) {
    for (let j = i + 1; j < layouts.length; j++) {
      x ||= isSeparated(layouts[i]!.x, layouts[j]!.x)
      y ||= isSeparated(layouts[i]!.y, layouts[j]!.y)
      if (x && y) return "xy"
    }
  }
  return x ? "x" : "y"
}
