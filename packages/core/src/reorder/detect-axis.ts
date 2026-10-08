import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import type { Axis, Box } from "../layout/box.ts"
import type { ReorderAxis } from "./types.ts"

const isSeparated = (a: Axis, b: Axis): boolean => Bool.or(a.max <= b.min, b.max <= a.min)

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
  // Every unordered pair of boxes.
  const pairs = Arr.flatMap(layouts, (a, i) => Arr.map(Arr.drop(layouts, i + 1), (b) => [a, b] as const))
  const x = Arr.some(pairs, ([a, b]) => isSeparated(a.x, b.x))
  const y = Arr.some(pairs, ([a, b]) => isSeparated(a.y, b.y))
  return Match.value({ x, y }).pipe(
    Match.when({ x: true, y: true }, (): ReorderAxis => "xy"),
    Match.when({ x: true }, (): ReorderAxis => "x"),
    Match.orElse((): ReorderAxis => "y"),
  )
}
