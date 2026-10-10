/**
 * The `Interpolator` module: the value kinds core blends (ADR-0026), each an `Entry` the
 * `InterpolatorRegistry` resolves a pair through: `number`, `array`, `color(mode)`, `unit` and
 * `complex`, in `defaults`' order, with their codecs (`ColorString`, `UnitString`,
 * `ComplexString`) and `unitOf`. A plain shape callers write to register their own kinds, so no
 * prototype (ADR-0028, decision 1). The blends' closures are on the per-frame path (ADR-0025).
 */
/// <reference path="./culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import { pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Str from "effect/String"
import * as Scalar from "./Scalar.ts"

/**
 * A value kind the registry can blend (ADR-0026): its Schema codec, and how two decoded values
 * of it blend.
 *
 * - **`codec`** decodes an endpoint of the kind. An endpoint it decodes is this entry's, and one
 *   it rejects isn't: decoding is matching. The registry decodes once, when a stream is built
 *   (`resolve`), never per frame.
 * - **`blend`** takes two decoded endpoints, once, and returns the closure the frame calls,
 *   which blends and then encodes with the codec's plain encode function, never
 *   `Schema.encode`. The pair's own work (comparing two structures, settling a unit) happens
 *   here, once. `None` when the pair can't blend: a Discrete pair (CONTEXT.md), which the
 *   registry switches at the first frame and warns about.
 *
 * The built-in entries (number, array, color via culori, unit string, complex value) are
 * registered when the Environment is set up, and consumers can register their own.
 */
export interface Entry<Decoded, Encoded> {
  /** Unique name for the value kind, e.g. "number", "color(rgb)", "unit". */
  readonly name: string
  /** The value kind: decodes an endpoint of it, and encodes a blended value back. */
  readonly codec: Schema.Codec<Decoded, Encoded>
  /** Two decoded endpoints' blend: the closure the frame calls with `t`, or `None`. */
  readonly blend: (from: Decoded, to: Decoded) => Option.Option<(t: number) => Encoded>
}

/**
 * An Interpolator codec's transformation, built on its plain parse and plain format (ADR-0026).
 * `format` is the encode the frame calls directly, so each format is written once and
 * `Schema.encode` never runs per frame.
 *
 * Both directions are sync getters. `parse` returns `None` for a value of another kind, which
 * leaves the decode without a value, and Schema fails it with its bare `InvalidValue`
 * ("Expected a valid value"). Selection fails most decodes it tries, and a descriptive issue,
 * built in an effectful getter or a filter, cost each one about as much as the decode itself
 * (decision 9).
 */
const parseAndFormat = <T, E>(
  parse: (input: E) => Option.Option<T>,
  format: (value: T) => E,
): SchemaTransformation.Transformation<T, E> =>
  SchemaTransformation.makeTransformation({
    decode: SchemaGetter.transformOptional((input: Option.Option<E>) => Option.flatMap(input, parse)),
    encode: SchemaGetter.transform(format),
  })

/** A number with an optional unit suffix: `10`, `"10px"`, `"-0.5em"`, `"50%"`. */
const UNIT_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i

/** A parsed number-with-unit string. `unit` is `""` for a bare number. */
interface ParsedUnit {
  readonly value: number
  readonly unit: string
}

/** Parse a number-with-unit string, or `None` when it isn't one (`"auto"`, a colour). */
const parseUnit = (input: string): Option.Option<ParsedUnit> =>
  Option.map(Option.fromNullishOr(UNIT_RE.exec(Str.trim(input))), ([, value = "", unit = ""]) => ({
    value: Number.parseFloat(value),
    unit,
  }))

/**
 * A number with its unit, as a string: the unit codec's plain encode (ADR-0026). The frame calls
 * it with a lerped value; `Schema.encode` never runs per frame.
 */
const formatUnit = (value: number, unit: string): string => `${value}${unit}`

/** A unit that is present (a bare number has none). */
const hasUnit: Predicate.Predicate<ParsedUnit> = Predicate.mapInput(Str.isNonEmpty, (parsed: ParsedUnit) => parsed.unit)

/** Two units that are not the same. */
const differ: Predicate.Predicate<readonly [ParsedUnit, ParsedUnit]> = ([a, b]) => a.unit !== b.unit

/** Two different units, both present (`"10px"`, `"1em"`): a pair `unit` can't blend, so a Discrete pair (ADR-0026). */
const incompatible: Predicate.Predicate<readonly [ParsedUnit, ParsedUnit]> = Predicate.and(
  Predicate.Tuple([hasUnit, hasUnit]),
  differ,
)

/** A pair's unit: `from`'s, or `to`'s when `from` is a bare number. */
const unitOfPair = (a: ParsedUnit, b: ParsedUnit): string =>
  Bool.match(hasUnit(a), { onTrue: () => a.unit, onFalse: () => b.unit })

/** Interpolates plain numbers: `Schema.Number` decodes a number as it is. */
export const number: Entry<number, number> = {
  name: "number",
  codec: Schema.Number,
  blend: (from, to) => Option.some((t: number) => Scalar.lerp(from, to, t)),
}

/**
 * `to`'s number at `index`, or `fallback` past its end. On the per-frame path (ADR-0025): an
 * early return, no `Option`.
 */
const endAt = (to: ReadonlyArray<number>, index: number, fallback: number): number => {
  const end = to[index]
  if (Predicate.isNullish(end)) return fallback
  return end
}

/** Interpolates fixed-length numeric arrays element-wise (e.g. RGB tuples). */
export const array: Entry<ReadonlyArray<number>, ReadonlyArray<number>> = {
  name: "array",
  codec: Schema.Array(Schema.Number),
  blend: (from, to) => Option.some((t: number) => Arr.map(from, (a, i) => Scalar.lerp(a, endAt(to, i, a), t))),
}

/**
 * A colour as culori holds it: its colour space (`mode`) and its channels. Core's own type, so
 * the declarations core emits don't lean on `culori.d.ts`.
 */
type Color = { readonly mode: string; readonly [channel: string]: number | string | undefined }

/** A culori colour: an object tagged with its colour space. */
const isColor = (value: unknown): value is Color => Predicate.hasProperty(value, "mode")

/** Parse a colour string, trimmed, or `None` when culori rejects it (`"auto"`, `"#zzz"`). */
const parseColor = (input: string): Option.Option<Color> =>
  Option.filter(Option.fromUndefinedOr(culoriParse(Str.trim(input))), isColor)

/**
 * A colour string (ADR-0026; CONTEXT.md's "color string") ↔ a culori colour. A string is a colour
 * iff culori's `parse` accepts it, trimmed. It encodes as `rgb(…)` / `rgba(…)` with culori's
 * `formatRgb`, the function the frame calls, so `"#000"` round-trips to `"rgb(0, 0, 0)"`.
 */
export const ColorString: Schema.Codec<Color, string> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare(isColor),
    parseAndFormat(parseColor, (color: Color): string => formatRgb(color)),
  ),
)

/**
 * Interpolates colours via culori (ADR-0026). `mode` is the colour space the blend runs in:
 * `"rgb"` by default (sRGB, as WAAPI blends, ADR-0024); pass `"oklch"` / `"lab"` for perceptual
 * blends.
 *
 * Built as a factory so an environment can register the space it prefers, over the one
 * `ColorString` codec; the default registry uses `"rgb"`. A string is a colour iff culori parses
 * it, trimmed, so CSS keywords like `"auto"` / `"inherit"` aren't, and named colours and modern
 * forms culori supports are.
 *
 * `blend` builds culori's interpolator once, when a stream is built, and the frame calls it and
 * formats with `formatRgb`, the codec's encode. Culori returns a new colour object on each call,
 * which no blend through culori avoids, and clamps `t` to [0, 1], so past 1 a colour holds at its
 * target (ADR-0024, decision 5).
 */
export const color = (mode = "rgb"): Entry<Color, string> => ({
  name: `color(${mode})`,
  codec: ColorString,
  blend: (from, to) => {
    const at = culoriInterpolate([from, to], mode)
    return Option.some((t: number) => formatRgb(at(t)))
  },
})

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
export const unit: Entry<ParsedUnit, string | number> = {
  name: "unit",
  codec: UnitString,
  blend: (from, to) =>
    Option.map(Option.liftPredicate([from, to] as const, compatible), ([a, b]) => {
      const unit = unitOfPair(a, b)
      return (t: number): string => formatUnit(Scalar.lerp(a.value, b.value, t), unit)
    }),
}

/** A single number token: optional sign, int/decimal, optional exponent. */
const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi

/**
 * A complex value, decoded (CONTEXT.md): the pieces around its numbers, and the numbers, in
 * document order. `parts.length === numbers.length + 1`.
 */
type Complex = { readonly parts: ReadonlyArray<string>; readonly numbers: ReadonlyArray<number> }

/** Two or more numeric tokens: what makes a string a complex value. */
const twoOrMore: Predicate.Predicate<ReadonlyArray<string>> = (tokens) => tokens.length >= 2

/** Parse a complex value: a string carrying two or more numbers, or `None`. */
const parseComplex = (input: string): Option.Option<Complex> =>
  pipe(
    input,
    Str.match(NUMBER_RE),
    Option.filter(twoOrMore),
    Option.map((tokens) => ({
      parts: Str.split(input, NUMBER_RE),
      numbers: Arr.map(tokens, (token) => Number.parseFloat(token)),
    })),
  )

/**
 * A complex value's parts and numbers, interleaved: the complex codec's plain encode (ADR-0026).
 * On the per-frame path: a counted loop, and nothing allocated but the string.
 */
const formatComplex = (parts: ReadonlyArray<string>, numbers: ReadonlyArray<number>): string => {
  let out = Arr.getUnsafe(parts, 0)
  for (let i = 0; i < numbers.length; i++) out += String(Arr.getUnsafe(numbers, i)) + Arr.getUnsafe(parts, i + 1)
  return out
}

/**
 * A complex value (ADR-0015, ADR-0026; CONTEXT.md) ↔ its parts and numbers: a string carrying two
 * or more numbers, an SVG `d` or `points`, a `filter`, a multi-part `box-shadow`. It encodes with
 * `formatComplex`, the function the frame calls; numbers come back in JavaScript's shortest form,
 * so `"M0.50,1e3"` encodes back as `"M0.5,1000"`.
 */
export const ComplexString: Schema.Codec<Complex, string> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Struct({ parts: Schema.Array(Schema.String), numbers: Schema.Array(Schema.Number) }),
    parseAndFormat(
      parseComplex,
      (complex: Complex): string => formatComplex(complex.parts, complex.numbers),
    ),
  ),
)

/** Two complex values of one structure: the same parts around their numbers, so as many numbers. */
const sameStructure: Equivalence.Equivalence<Complex> = Equivalence.mapInput(
  Arr.makeEquivalence(Equivalence.String),
  (complex: Complex) => complex.parts,
)

/**
 * Two complex values' blend, number by number. The frame writes the lerped numbers into one array
 * allocated here, once, and interleaves them with the parts through `formatComplex`, the codec's
 * encode: a counted loop, and nothing allocated per frame but the string.
 */
const blendNumbers = (from: Complex, to: Complex): ((t: number) => string) => {
  const numbers = Arr.copy(from.numbers)
  return (t) => {
    for (let i = 0; i < numbers.length; i++) {
      numbers[i] = Scalar.lerp(Arr.getUnsafe(from.numbers, i), Arr.getUnsafe(to.numbers, i), t)
    }
    return formatComplex(from.parts, numbers)
  }
}

/**
 * Generic "complex value" interpolator (Motion's complex value type): a string
 * carrying ≥2 embedded numbers — an SVG `d`/`points`, a `filter`, a multi-part
 * `box-shadow`, … — interpolated number-by-number WHEN both endpoints share the
 * same structure (the same parts around the same count of numbers). Two of
 * different structures can't blend: `None`, a Discrete pair, which `resolve`
 * switches to `to` at the first frame past 0 and warns about (ADR-0024, ADR-0026).
 *
 * This is the **same-structure tier of path morphing** (ADR-0015): two `d`/`points`
 * with the same command sequence morph for free. **Arbitrary-structure** morphing
 * (aligning paths with *different* command counts) is a separate, opt-in, heavier
 * interpolator (`@wardic/path-morph`, deferred) — registered at higher precedence
 * when wanted; it never enters the default bundle.
 *
 * Registered LAST so the specific interpolators win: `"10px"` → unit (a single
 * number), `"#fff"`/`"rgb(…)"` → color (decoded earlier), and only genuinely
 * multi-number structural strings land here.
 *
 * Known limit (as Motion, without a path normalizer): SVG arc flags in an `A`/`a`
 * command are treated as plain numbers, so an arc path can interpolate through
 * invalid flag values — same-structure `M/L/C/S/Q/T/Z` morphing is sound.
 *
 * Both strings are decoded once, when a stream is built (`ComplexString`), and the closure
 * `blend` returns is on the per-frame path (ADR-0025): it only lerps and formats.
 */
export const complex: Entry<Complex, string> = {
  name: "complex",
  codec: ComplexString,
  blend: (from, to) =>
    Bool.match(sameStructure(from, to), {
      onTrue: () => Option.some(blendNumbers(from, to)),
      onFalse: () => Option.none(),
    }),
}

/**
 * The interpolators core ships with, in resolution order. `number` and `array`
 * are checked first (cheap, unambiguous); `color` before `unit` so `"#fff"`
 * routes to color while `"10px"` routes to unit; `complex` LAST so it only
 * catches multi-number structural strings (SVG `d`/`points`, `filter`,
 * `box-shadow`) the specific entries didn't claim (ADR-0015).
 */
export const defaults: ReadonlyArray<Entry<any, any>> = [number, array, color("rgb"), unit, complex]
