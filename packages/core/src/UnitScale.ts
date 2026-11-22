/**
 * How many of Motion's units a key counts as, so a spring's rest thresholds fit the distances it moves:
 * an Environment's rule, by the key and the distance its leg goes, 1 for every key by default, Motion's
 * own. A scene in metres gives `x`, `y` and `z` 100 (`layer(100)`), so a 10 m move rests within 5 mm and
 * a 4 cm one within 0.05 mm, where Motion's thresholds would stop a move of 5 units or more 4–5% short and
 * snap it. A key whose values span 0 to 1 can rest by its share of the distance instead (`relative`), as a
 * blended key's progress does. A threshold a spring is given is kept as it is.
 *
 * @example
 * import * as UnitScale from "@wardic/core/UnitScale"
 *
 * const env = Layer.mergeAll(sceneLayers, UnitScale.layer(100))
 * // or a rule of the Environment's own: a colour's channels by their share of the distance
 * const rule: UnitScale.Rule = (key, distance) => (isChannel(key) ? UnitScale.relative(distance, 0.001) : UnitScale.position(100)(key, distance))
 */
// ADR-0069 decision 8; ADR-0073, *Amendment (#883)*: a `Context.Reference` with its default, read by core
// itself from the runtime its spines and Batches hold, so no binding passes it (as `PressClaims` and
// `DragActivity` are References). A rule by key and distance since PR 3 (Q2): three's linear colour
// channels rest relative to their distance. Tier 2 (ADR-0008): Effect-typed, for Environment authors.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/**
 * How many of Motion's units `key` counts as on a leg of `distance` (its target less its start, in the
 * key's own units): the scale its spring's rest thresholds are read at. Asked once per key per leg.
 */
export type Rule = (key: string, distance: number) => number

/** Motion's own: every key at 1. */
export const MOTIONS: Rule = () => 1

/** The keys a Subject's position names. */
const POSITION: ReadonlySet<string> = new Set(["x", "y", "z"])

/** `x`, `y` and `z` at `scale` of Motion's units, every other key at 1: a scene in metres gives 100. */
// Once a leg per key: a plain branch, no matcher made.
export const position = (scale: number): Rule => (key) => {
  if (POSITION.has(key)) return scale
  return 1
}

/**
 * The scale for a key that rests by its share of `distance`, as a blended key's 0 → 100 progress does
 * (`Machine.springBlend`): every leg lands in the same time, however far it goes. `floor` is the least
 * distance it counts, so a key that isn't moving but has a speed still comes to rest.
 */
export const relative = (distance: number, floor: number): number => 100 / Math.max(Math.abs(distance), floor)

/** The Environment's rule: Motion's, unless its Layers give another. */
export const UnitScale: Context.Reference<Rule> = /*#__PURE__*/ Context.Reference<Rule>("@wardic/core/UnitScale", { defaultValue: () => MOTIONS })

/** A Layer giving `rule` as the Environment's. */
export const layerWith = (rule: Rule): Layer.Layer<never> => Layer.succeed(UnitScale, rule)

/** A Layer giving `x`, `y` and `z` at `scale`: `layerWith(position(scale))`. */
export const layer = (scale: number): Layer.Layer<never> => layerWith(position(scale))
