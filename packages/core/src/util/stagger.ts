import type { Easing } from "../options.ts"

/** Where a stagger originates within the set of children. */
export type StaggerOrigin = "first" | "last" | "center" | number

export interface StaggerOptions {
  /** Origin index the delay grows outward from. Default `"first"`. */
  readonly from?: StaggerOrigin
  /** Optional easing applied across the index distribution. */
  readonly ease?: Easing
}

const resolveOrigin = (from: StaggerOrigin, total: number): number => {
  switch (from) {
    case "first":
      return 0
    case "last":
      return total - 1
    case "center":
      return (total - 1) / 2
    default:
      return from
  }
}

/**
 * Builds a per-child delay function: `(index, total) => delaySeconds`. Delay
 * grows with distance from the origin; an optional easing reshapes the curve.
 *
 * ```ts
 * const d = stagger(0.05, { from: "center" })
 * d(0, 5) // delay for the first child
 * ```
 */
export const stagger = (
  amount: number,
  options: StaggerOptions = {},
): ((index: number, total: number) => number) => {
  const { from = "first", ease } = options
  return (index, total) => {
    const origin = resolveOrigin(from, total)
    const dist = Math.abs(origin - index)
    if (ease === undefined) return amount * dist
    const max = Math.max(1, total - 1)
    return amount * ease(dist / max) * max
  }
}
