/**
 * How many of Motion's units an Environment's `x`, `y` and `z` count as, so a spring's rest thresholds
 * fit the distances it moves: 1 by default, Motion's own. A scene in metres gives 100, so a 10 m move
 * rests within 5 mm and a 4 cm one within 0.05 mm, where Motion's thresholds would stop a move of 5 units
 * or more 4–5% short and snap it. Other keys, and a threshold a spring is given, keep Motion's.
 *
 * @example
 * import * as UnitScale from "@wardic/core/UnitScale"
 *
 * const env = Layer.mergeAll(sceneLayers, UnitScale.layer(100))
 */
// ADR-0069 decision 8; ADR-0073, *Amendment (#883)*: a `Context.Reference` with its default, read by core
// itself from the runtime its spines and Batches hold, so no binding passes it (as `PressClaims` and
// `DragActivity` are References). Tier 2 (ADR-0008): Effect-typed, for Environment authors.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/** The Environment's unit scale: 1 unless its Layers give another. */
export const UnitScale: Context.Reference<number> = /*#__PURE__*/ Context.Reference<number>("@wardic/core/UnitScale", { defaultValue: () => 1 })

/** A Layer giving `scale` as the Environment's unit scale. */
export const layer = (scale: number): Layer.Layer<never> => Layer.succeed(UnitScale, scale)

/** The keys the unit scale counts: a Subject's position. */
const SCALED: ReadonlySet<string> = new Set(["x", "y", "z"])

/** The scale `key`'s rest thresholds are read at: `unitScale` for `x`, `y` and `z`, else 1. */
// Once a leg per key: a plain branch, no matcher made.
export const forKey = (unitScale: number, key: string): number => {
  if (SCALED.has(key)) return unitScale
  return 1
}
