import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"

/** A number with an optional unit suffix: `10`, `"10px"`, `"-0.5em"`, `"50%"`. */
const UNIT_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i

/** A parsed number-with-unit string. `unit` is `""` for a bare number. */
export interface ParsedUnit {
  readonly value: number
  readonly unit: string
}

/** Parse a number-with-unit string, or `None` when it isn't one (`"auto"`, a colour). */
export const parseUnit = (input: string): Option.Option<ParsedUnit> =>
  Option.map(Option.fromNullishOr(UNIT_RE.exec(Str.trim(input))), ([, value = "", unit = ""]) => ({
    value: Number.parseFloat(value),
    unit,
  }))

/** A unit that is present (a bare number has none). */
const hasUnit: Predicate.Predicate<ParsedUnit> = Predicate.mapInput(Str.isNonEmpty, (parsed: ParsedUnit) => parsed.unit)

/** Two units that are not the same. */
const differ: Predicate.Predicate<readonly [ParsedUnit, ParsedUnit]> = ([a, b]) => a.unit !== b.unit

/** Two different units, both present (`"10px"`, `"1em"`): a pair the registry dies on. */
export const incompatible: Predicate.Predicate<readonly [ParsedUnit, ParsedUnit]> = Predicate.and(
  Predicate.Tuple([hasUnit, hasUnit]),
  differ,
)

/** A pair's unit: `from`'s, or `to`'s when `from` is a bare number. */
export const unitOfPair = (a: ParsedUnit, b: ParsedUnit): string =>
  Bool.match(hasUnit(a), { onTrue: () => a.unit, onFalse: () => b.unit })
