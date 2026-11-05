/**
 * Gesture states laid over a base: an Override stack is a list of partial targets, each on or off, and
 * `resolve` merges the ones that are on into one target, a later one's values winning. It's how hover,
 * press and drag lay their targets over `animate`.
 *
 * @example
 * import * as Override from "@wardic/core/Override"
 *
 * const target = Override.resolve([
 *   { active: true, values: { scale: 1, opacity: 1 } }, // animate
 *   { active: hovered, values: { scale: 1.05 } }, // whileHover
 *   { active: pressed, values: { scale: 0.95 } }, // whileTap
 * ])
 */
// CONTEXT.md's **Override stack**, deliberately not a "layer", which collides with Effect's and an
// Environment's `Layer` (ADR-0007).
import * as Arr from "effect/Array"
import * as Combiner from "effect/Combiner"
import * as Rec from "effect/Record"
import type * as Values from "./Values.ts"

/** One entry of an Override stack: a partial target whose values count only while it's `active`. */
export interface Override {
  /** Whether its state is on: a hover, a press. */
  readonly active: boolean
  /** The values it sets while it's on. */
  readonly values: Values.Values
}

/**
 * An Override stack resolved to one target: for each key, the last active entry that sets it wins, and
 * an inactive entry counts for nothing. The stack is in rising priority, the base first; its order is the
 * binding's to choose.
 */
// ADR-0007. A pure merge: the binding owns the priority order and the variant names (recognition vs
// response, ADR-0004). The result feeds `springValues` / `animateValues`.
export const resolve = (overrides: ReadonlyArray<Override>): Values.Values =>
  Arr.reduce(Arr.filter(overrides, isActive), Rec.empty<string, number | string>(), (out, override) =>
    // Own keys only (value-maps are plain objects, but stay defensive); a later entry's value wins.
    Rec.union(out, override.values, lastWins.combine),
  )

/** An entry that contributes: one whose state is on. */
const isActive = (override: Override): boolean => override.active

/** For a key two entries define, the later (higher-priority) entry's value. */
const lastWins = Combiner.last<number | string>()
