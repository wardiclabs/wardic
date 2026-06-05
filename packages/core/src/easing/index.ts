export * from "./penner.ts"
export * from "./generators.ts"

import * as penner from "./penner.ts"

/**
 * All Penner easings as a single namespace object, for ergonomic access like
 * `easings.easeOutCubic`. Generators (`cubicBezier`, `steps`, `springEasing`)
 * are separate named exports.
 */
export const easings = { ...penner } as const
