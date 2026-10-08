import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { parseAndFormat } from "./codec.ts"
import { formatUnit, incompatible, type ParsedUnit, parseUnit, unitOfPair } from "./parse-unit.ts"

/** An endpoint as the unit codec parses it: a bare number, like `"120"`, has no unit. */
const parseEndpoint = (input: string | number): Option.Option<ParsedUnit> =>
  Match.value(input).pipe(
    Match.when(Predicate.isNumber, (value) => Option.some({ value, unit: "" })),
    Match.orElse(parseUnit),
  )

/**
 * A unit string (ADR-0026): a number with an optional unit suffix (`"10px"`, `"-0.5em"`, `"50%"`,
 * `"120"`), or a bare number, ↔ its value and unit. A bare number decodes with no unit, as `"120"`
 * does, so in a pair it takes the other endpoint's unit. It encodes with `formatUnit`, the
 * function the frame calls.
 */
export const UnitString: Schema.Codec<ParsedUnit, string | number> = Schema.Union([Schema.String, Schema.Number]).pipe(
  Schema.decodeTo(
    Schema.Struct({ value: Schema.Number, unit: Schema.String }),
    parseAndFormat(
      parseEndpoint,
      (parsed: ParsedUnit): string | number => formatUnit(parsed.value, parsed.unit),
    ),
  ),
)

/**
 * The unit of a number-with-unit string as the `unit` interpolator parses it (`""` for a bare
 * number), or `None` when `value` isn't one (`"auto"`, a colour). Two strings whose units are
 * both non-empty and differ are a Discrete pair (ADR-0026, decision 4).
 */
export const unitOf = (value: string): Option.Option<string> => Option.map(parseUnit(value), (parsed) => parsed.unit)

/** Two units that can blend: the same, or one of them absent (a bare number). */
const compatible: Predicate.Predicate<readonly [ParsedUnit, ParsedUnit]> = Predicate.not(incompatible)

/**
 * Interpolates a number with a unit suffix, e.g. `"10px" → "20px"`, `"0%" → "100%"`, and a bare
 * number paired with one, `0 → "10px"`: the unit is taken from whichever endpoint has one, once,
 * when a stream is built, and the frame lerps the value and formats it with `formatUnit`, the
 * codec's encode (ADR-0026).
 *
 * Two different units, both present (`"10px"`, `"1em"`), can't blend: `None`, a Discrete pair,
 * which `resolve` switches at the first frame and warns about (decision 4).
 */
export const unitInterpolator: InterpolatorEntry<ParsedUnit, string | number> = {
  name: "unit",
  codec: UnitString,
  blend: (from, to) =>
    Option.map(Option.liftPredicate([from, to] as const, compatible), ([a, b]) => {
      const unit = unitOfPair(a, b)
      return (t: number): string => formatUnit(lerp(a.value, b.value, t), unit)
    }),
}
