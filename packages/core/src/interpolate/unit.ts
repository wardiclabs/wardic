import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { discrete } from "./discrete.ts"
import { parseUnit, unitOfPair } from "./parse-unit.ts"

/**
 * The unit of a number-with-unit string as the `unit` interpolator parses it (`""` for a bare
 * number), or `None` when `value` isn't one (`"auto"`, a colour). Two strings whose units are
 * both non-empty and differ are a pair the registry dies on (registry.ts `bind`).
 */
export const unitOf = (value: string): Option.Option<string> => Option.map(parseUnit(value), (parsed) => parsed.unit)

/** A string the `unit` interpolator parses. */
const isUnitString: Predicate.Predicate<unknown> = Predicate.compose(Predicate.isString, (value: string) =>
  Option.isSome(parseUnit(value)),
)

/**
 * Interpolates a numeric value carrying a unit suffix, e.g. `"10px" → "20px"`,
 * `"0%" → "100%"`. The unit is taken from whichever endpoint has one.
 *
 * It parses both endpoints on every call. The registry never calls it per frame: `resolve`
 * parses a unit pair once and blends the parsed numbers (registry.ts `bind`).
 */
export const unitInterpolator: InterpolatorEntry<string> = {
  name: "unit",
  match: isUnitString,
  interpolate: (from, to, t) =>
    Option.match(Option.all([parseUnit(from), parseUnit(to)]), {
      onNone: () => discrete(from, to, t), // a Discrete pair (ADR-0024)
      onSome: ([a, b]) => `${lerp(a.value, b.value, t)}${unitOfPair(a, b)}`,
    }),
}
