import type { Values } from "./options.ts"

/**
 * One entry in an **Override stack**: a partial target that contributes its
 * `values` only while `active`. (CONTEXT.md "Override stack" — deliberately
 * *not* called a "layer", which collides with Effect/Environment `Layer`.)
 */
export interface Override {
  readonly active: boolean
  readonly values: Values
}

/**
 * Resolve an Override stack to a single target (see ADR-0007). Entries are in
 * **ascending priority** (index 0 = base, e.g. `animate`; later entries are
 * higher-priority gesture states like `whileHover` → `whileTap` → `whileDrag`).
 * For each key, the **last active** entry that defines it wins; inactive entries
 * contribute nothing.
 *
 * Pure merge mechanism only: the binding owns the priority order and the variant
 * names (recognition vs response — ADR-0004). The result feeds `springValues` /
 * `animateValues`.
 */
export const resolveOverrides = (overrides: ReadonlyArray<Override>): Values => {
  const out: Record<string, number | string> = {}
  for (const override of overrides) {
    if (!override.active) continue
    for (const key in override.values) {
      // Own-prop guard: value-maps are plain objects, but stay defensive.
      if (Object.prototype.hasOwnProperty.call(override.values, key)) {
        out[key] = override.values[key]!
      }
    }
  }
  return out
}
