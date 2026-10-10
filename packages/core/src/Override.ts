/**
 * The `Override` module: CONTEXT.md's **Override stack**, the partial targets a gesture state
 * contributes over a component's base target, resolved to one target (ADR-0007).
 */
import * as Arr from "effect/Array"
import * as Combiner from "effect/Combiner"
import * as Rec from "effect/Record"
import type * as Values from "./Values.ts"

/**
 * One entry in an **Override stack**: a partial target that contributes its
 * `values` only while `active`. (CONTEXT.md "Override stack" — deliberately
 * *not* called a "layer", which collides with Effect/Environment `Layer`.)
 */
export interface Override {
  readonly active: boolean
  readonly values: Values.Values
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
export const resolve = (overrides: ReadonlyArray<Override>): Values.Values =>
  Arr.reduce(Arr.filter(overrides, isActive), Rec.empty<string, number | string>(), (out, override) =>
    // Own keys only (value-maps are plain objects, but stay defensive); a later entry's value wins.
    Rec.union(out, override.values, lastWins.combine),
  )

/** An entry that contributes: one whose state is on. */
const isActive = (override: Override): boolean => override.active

/** For a key two entries define, the later (higher-priority) entry's value. */
const lastWins = Combiner.last<number | string>()
