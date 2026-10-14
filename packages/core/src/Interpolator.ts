/**
 * The `Interpolator` module: the value kinds core blends (ADR-0026), each an `Entry` the
 * `InterpolatorRegistry` resolves a pair through: `number`, `array`, `unit` and `complex`, in
 * `defaults`' order, with their codecs (`UnitString`, `ComplexString`) and `unitOf`. An Environment
 * registers its own kinds beside them, and names the spans and kinds of token in its complex values
 * (`complexWith`): the DOM's colours are `@wardic/dom`'s, since core names no Environment's syntax
 * (ADR-0036). A plain shape callers write to register their own kinds, so no prototype (ADR-0028,
 * decision 1). The blends' closures are on the per-frame path (ADR-0025).
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Str from "effect/String"
import { type Tokenizer, tokenizerOf } from "./internal/complexTokens.ts"
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
 * The built-in entries (number, array, unit string, complex value) are registered when the
 * Environment is set up, beside the Environment's own (the DOM's colours, ADR-0036), and consumers
 * can register their own.
 */
export interface Entry<Decoded, Encoded> {
  /** Unique name for the value kind, e.g. "number", "unit". */
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
 *
 * Core's codecs are built with it, and an Environment builds its own the same way (the DOM's
 * `ColorString`).
 */
export const parseAndFormat = <T, E>(
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

/** Parse a number-with-unit string, or `None` when it isn't one (`"auto"`, `"M0,0 L1,1"`). */
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

/**
 * Two arrays' blend, element by element, `from`'s length: past `to`'s end an element holds
 * `from`'s. On the per-frame path (ADR-0025): a counted loop into a new array each frame, and no
 * closure per frame.
 */
const blendArrays =
  (from: ReadonlyArray<number>, to: ReadonlyArray<number>) =>
  (t: number): ReadonlyArray<number> => {
    const out: Array<number> = []
    for (let i = 0; i < from.length; i++) out.push(Scalar.lerp(from[i], endAt(to, i, from[i]), t))
    return out
  }

/** Interpolates fixed-length numeric arrays element-wise (e.g. RGB tuples). */
export const array: Entry<ReadonlyArray<number>, ReadonlyArray<number>> = {
  name: "array",
  codec: Schema.Array(Schema.Number),
  blend: (from, to) => Option.some(blendArrays(from, to)),
}

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
 * number), or `None` when `value` isn't one (`"auto"`, `"M0,0 L1,1"`). Two strings whose units are
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

/**
 * A token of one of its Environment's kinds, decoded (#160, ADR-0036): the kind, its Interpolator's
 * name, and the value that Interpolator decoded.
 */
export interface KindToken {
  readonly kind: string
  readonly value: unknown
}

/** A complex value's token, decoded: a number, or a token of one of its Environment's kinds (#160). */
export type ComplexToken = number | KindToken

/**
 * A complex value, decoded (CONTEXT.md): the pieces around its tokens, and the tokens, numbers and
 * its Environment's kinds, in document order. `parts.length === tokens.length + 1`.
 */
export interface Complex {
  readonly parts: ReadonlyArray<string>
  readonly tokens: ReadonlyArray<ComplexToken>
}

/**
 * A kind of token an Environment names in its complex values besides numbers (#160, ADR-0036):
 * what one looks like, and the Interpolator that decodes, blends and encodes it, usually the one
 * the Environment registers for a value of that kind on its own (the DOM's colours). Its tokens
 * are told apart by that Interpolator's name.
 */
export interface TokenKind<Decoded = any> {
  /**
   * What a token of the kind looks like: matched case-insensitively, after the text spans and
   * before numbers. No capturing groups: the codec splits a string around its tokens.
   */
  readonly pattern: RegExp
  /** How a token of the kind decodes, blends and encodes. */
  readonly entry: Entry<Decoded, string>
}

/** A kind of token, ready to use: its name, and its Interpolator's decode, encode and blend. Built once per codec. */
interface Kind {
  readonly name: string
  readonly decode: (token: string) => Option.Option<unknown>
  readonly encode: (value: unknown) => string
  readonly blend: (from: unknown, to: unknown) => Option.Option<(t: number) => string>
}

const kindFrom = (kind: TokenKind): Kind => ({
  name: kind.entry.name,
  decode: Schema.decodeUnknownOption(kind.entry.codec),
  encode: Schema.encodeSync(kind.entry.codec),
  blend: kind.entry.blend,
})

/** A token of one of the kinds named `names`, decoded. */
const isKindTokenOf =
  (names: ReadonlyArray<string>) =>
  (value: unknown): value is KindToken =>
    Predicate.hasProperty(value, "kind") && Predicate.hasProperty(value, "value") && Arr.contains(names, value.kind)

/** A token of a kind, not a number. */
const isKindToken: Predicate.Refinement<ComplexToken, KindToken> = (token): token is KindToken => !Predicate.isNumber(token)

/** A token's text as a number, or as a token of the kind its tokenizer matched; `None` for one its kind can't decode. */
const parseTokenWith =
  (tokenizer: Tokenizer, kinds: ReadonlyArray<Kind>) =>
  (token: string): Option.Option<ComplexToken> =>
    Option.match(tokenizer.kindOf(token), {
      onNone: () => Option.some(Number.parseFloat(token)),
      onSome: (i) => Option.map(kinds[i].decode(token), (value): ComplexToken => ({ kind: kinds[i].name, value })),
    })

/**
 * A decoded value that is one token of a kind and nothing else around it: a value of that kind,
 * for its own Interpolator (the DOM's lone colour), not a complex value.
 */
const isLoneKindToken = (complex: Complex): boolean =>
  complex.tokens.length === 1 && Arr.every(complex.tokens, isKindToken) && Arr.every(complex.parts, (part) => Str.isEmpty(Str.trim(part)))

/** A string that is only a number with a unit (`"10px"`): a unit string, not a complex value. */
const isUnitString = (input: string): boolean => Option.isSome(parseUnit(input))

/** A string's text around its tokens, and the tokens' text, with every text span kept as text. */
interface Folded {
  readonly parts: ReadonlyArray<string>
  readonly tokens: ReadonlyArray<string>
}

/**
 * `input` split around the tokens a tokenizer matched, each text span its Environment names folded
 * back into the text on either side of it (#158): the digits in it are never numbers, and it's
 * written as it stands. Built when a stream is built, in one pass.
 */
const foldText = (tokenizer: Tokenizer, input: string, matched: ReadonlyArray<string>): Folded => {
  const split = Str.split(input, tokenizer.tokenRe)
  const parts: Array<string> = [split[0]]
  const tokens: Array<string> = []
  Arr.reduce(matched, undefined, (_, token, i): undefined => {
    if (tokenizer.isText(token)) {
      parts[parts.length - 1] += token + split[i + 1]
      return undefined
    }
    tokens.push(token)
    parts.push(split[i + 1])
    return undefined
  })
  return { parts, tokens }
}

/** Something to blend: at least one number or token of a kind outside the text spans. */
const hasTokens: Predicate.Predicate<Folded> = (folded) => folded.tokens.length > 0

/**
 * A complex value's parser for a tokenizer and its kinds: a string carrying one or more numbers or
 * tokens of a kind among other text (#61, Motion's rule; two or more numbers before), any text span
 * kept as text (#158). `None` for a unit string, a lone token of a kind, a string with no tokens (a
 * lone text span), or one with a token its kind can't decode.
 */
const parseComplexWith = (tokenizer: Tokenizer, kinds: ReadonlyArray<Kind>) => {
  const parseToken = parseTokenWith(tokenizer, kinds)
  return (input: string): Option.Option<Complex> =>
    pipe(
      Option.liftPredicate(input, Predicate.not(isUnitString)),
      Option.flatMap(Str.match(tokenizer.tokenRe)),
      Option.map((matched) => foldText(tokenizer, input, matched)),
      Option.filter(hasTokens),
      Option.flatMap((folded) =>
        Option.map(Option.all(Arr.map(folded.tokens, parseToken)), (tokens): Complex => ({ parts: folded.parts, tokens }))),
      Option.filter(Predicate.not(isLoneKindToken)),
    )
}

/**
 * A complex value's parts and tokens, interleaved: the complex codec's plain encode (ADR-0026).
 * A number is written in its shortest form, and a token of a kind by its kind's encode. Its kind is
 * one of the codec's: Schema checks the tokens before it encodes.
 */
const formatComplexWith = (kinds: ReadonlyArray<Kind>) => {
  const encoders: Record<string, (value: unknown) => string> = Rec.fromEntries(Arr.map(kinds, (kind) => [kind.name, kind.encode] as const))
  const formatToken = (token: ComplexToken): string =>
    Match.value(token).pipe(
      Match.when(Predicate.isNumber, (value) => String(value)),
      Match.orElse((token) => encoders[token.kind](token.value)),
    )
  return (complex: Complex): string =>
    Arr.reduce(complex.tokens, complex.parts[0], (out, token, i) => out + formatToken(token) + complex.parts[i + 1])
}

/** The spans and kinds of token an Environment names in its complex values (#158, #160; ADR-0036). */
export interface ComplexOptions {
  /**
   * Patterns for spans that are only text: matched whole, before tokens and numbers, so the digits
   * in them are never numbers; kept as text; and counted when two values match. No capturing
   * groups. None by default: core names no Environment's syntax (the DOM's are in `@wardic/dom`,
   * ADR-0035 *Amendment (#158)*).
   */
  readonly text?: ReadonlyArray<RegExp>
  /**
   * Kinds of token besides numbers (#160): each a pattern and the Interpolator its tokens decode,
   * blend and encode through. Two values blend with the same count of each kind, the n-th token of
   * a kind blending with the n-th of the same kind. None by default (the DOM's colours are in
   * `@wardic/dom`, ADR-0036).
   */
  readonly tokens?: ReadonlyArray<TokenKind>
}

/** The options' text spans, or none. */
const textOf = (options: ComplexOptions): ReadonlyArray<RegExp> => Option.getOrElse(Option.fromUndefinedOr(options.text), () => [])

/** The options' kinds of token, ready to use, or none. */
const kindsOf = (options: ComplexOptions): ReadonlyArray<Kind> =>
  Arr.map(Option.getOrElse(Option.fromUndefinedOr(options.tokens), () => []), kindFrom)

/** A tokenizer for the options' text spans and kinds. */
const tokenizerFor = (options: ComplexOptions): Tokenizer =>
  tokenizerOf(textOf(options), Arr.map(Option.getOrElse(Option.fromUndefinedOr(options.tokens), () => []), (kind) => kind.pattern))

/**
 * A complex value codec (ADR-0015, ADR-0026; CONTEXT.md) for an Environment's text spans and kinds
 * of token: a string carrying one or more numbers or tokens of a kind among other text ↔ its parts
 * and tokens. It encodes numbers in JavaScript's shortest form and each token by its kind's encode,
 * so `"M0.50,1e3"` encodes back as `"M0.5,1000"`.
 */
export const complexStringWith = (options: ComplexOptions): Schema.Codec<Complex, string> => {
  const kinds = kindsOf(options)
  const isKindToken = isKindTokenOf(Arr.map(kinds, (kind) => kind.name))
  return Schema.String.pipe(
    Schema.decodeTo(
      Schema.Struct({ parts: Schema.Array(Schema.String), tokens: Schema.Array(Schema.Union([Schema.Number, Schema.declare(isKindToken)])) }),
      parseAndFormat(parseComplexWith(tokenizerFor(options), kinds), formatComplexWith(kinds)),
    ),
  )
}

/** The complex value codec with no text spans and no kinds: core's default. */
export const ComplexString: Schema.Codec<Complex, string> = complexStringWith({})

/**
 * One token of the target, with what it blends from: two numbers, or a token of a kind's blend
 * (`blend` set). Built once, when a stream is built.
 */
interface Slot {
  readonly from: number
  readonly to: number
  readonly blend: ((t: number) => string) | undefined
}

/** A slot's token at progress `t`. On the per-frame path (ADR-0025): an early return, no `Option`. */
const slotAt = (slot: Slot, t: number): string => {
  const blend = slot.blend
  if (Predicate.isNotUndefined(blend)) return blend(t)
  return String(Scalar.lerp(slot.from, slot.to, t))
}

/**
 * Two complex values' blend, token by token, in the target's parts. The frame writes each slot's
 * token between the parts: a counted loop, and nothing allocated per frame but the string and
 * what each kind's blend allocates (the DOM's colours: culori's colour object).
 */
const blendSlots = (parts: ReadonlyArray<string>, slots: ReadonlyArray<Slot>): ((t: number) => string) => (t) => {
  let out = parts[0]
  for (let i = 0; i < slots.length; i++) out += slotAt(slots[i], t) + parts[i + 1]
  return out
}

/** A decoded value's numbers, and its tokens of a kind, each in document order. */
const numbersOf = (complex: Complex): ReadonlyArray<number> => Arr.filter(complex.tokens, Predicate.isNumber)
const kindTokensOf = (complex: Complex): ReadonlyArray<KindToken> => Arr.filter(complex.tokens, isKindToken)

/** How many tokens of `kind` a decoded value holds. */
const countOf = (complex: Complex, kind: string): number => Arr.filter(kindTokensOf(complex), (token) => token.kind === kind).length

/**
 * Whether two complex values blend (#61, Motion's `mixComplex`): the same count of each kind of
 * token (#160) and of text spans (#158), and the start holding at least as many numbers as the
 * target. The target's text is written, its text spans with it, so a text span takes the target's
 * at the first frame, as Motion's `mixImmediate` does.
 */
const matchesWith =
  (names: ReadonlyArray<string>, textCountOf: (input: string) => number) =>
  (from: Complex, to: Complex): boolean =>
    Arr.every(names, (name) => countOf(from, name) === countOf(to, name)) &&
    textCountOf(Arr.join(from.parts, "")) === textCountOf(Arr.join(to.parts, "")) &&
    numbersOf(from).length >= numbersOf(to).length

/**
 * The target's slots, kind by kind, in order (Motion's `matchOrder`): its n-th number blends from
 * the start's n-th number, and its n-th token of a kind from the start's n-th of that kind,
 * through that kind's Interpolator. A start's numbers past the target's are dropped. In range by
 * construction: `matches` held first. `None` when a kind's Interpolator can't blend a pair of its
 * tokens. Built when a stream is built: one pass, counting each kind as it goes.
 */
const slotsOf = (kinds: Readonly<Record<string, Kind>>, from: Complex, to: Complex): Option.Option<ReadonlyArray<Slot>> => {
  const fromNumbers = numbersOf(from)
  const fromKinds = Arr.groupBy(kindTokensOf(from), (token) => token.kind)
  const read = { numbers: 0, kinds: Rec.map(fromKinds, (): number => 0) }
  return Option.all(Arr.map(to.tokens, (token): Option.Option<Slot> =>
    Match.value(token).pipe(
      Match.when(Predicate.isNumber, (value) => Option.some<Slot>({ from: fromNumbers[read.numbers++], to: value, blend: undefined })),
      Match.orElse((token) =>
        Option.map(
          kinds[token.kind].blend(fromKinds[token.kind][read.kinds[token.kind]++].value, token.value),
          (blend): Slot => ({ from: 0, to: 0, blend }),
        )),
    )))
}

/**
 * Generic "complex value" interpolator (Motion's complex value type) for an Environment's text
 * spans and kinds of token: a string carrying one or more numbers or tokens of a kind among other
 * text, an SVG `d`/`points`, a `filter`, a `box-shadow`, a gradient, blended token by token (#61).
 * Two blend when they hold the same count of each kind and the start holds at least as many numbers
 * as the target: the n-th number blends with the n-th number and the n-th token of a kind with the
 * n-th of that kind, through that kind's Interpolator, written in the target's parts (Motion's
 * `mixComplex`). With the DOM's colours a computed `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px` blends into
 * an authored `0px 8px 24px rgba(0, 0, 0, 0.3)`. Any other two can't: `None`, a Discrete pair,
 * which `resolve` switches to `to` at the first frame past 0 and warns about (ADR-0024, ADR-0026).
 *
 * This is the **same-structure tier of path morphing** (ADR-0015): two `d`/`points` with the same
 * command sequence morph for free. **Arbitrary-structure** morphing (aligning paths with
 * *different* command counts) is a separate, opt-in, heavier interpolator (`@wardic/path-morph`,
 * deferred), registered at higher precedence when wanted; it never enters the default bundle.
 *
 * Registered LAST so the specific interpolators win: `"10px"` → unit, a lone token of a kind → its
 * kind's own Interpolator, registered before it (the DOM's colours), and only strings with tokens
 * among other text land here.
 *
 * Known limit (as Motion, without a path normalizer): SVG arc flags in an `A`/`a` command are
 * treated as plain numbers, so an arc path can interpolate through invalid flag values.
 *
 * Both strings are decoded once, when a stream is built (`complexStringWith`), and the closure
 * `blend` returns is on the per-frame path (ADR-0025): it only lerps, calls each kind's blend and
 * formats.
 */
export const complexWith = (options: ComplexOptions): Entry<Complex, string> => {
  const kinds = kindsOf(options)
  const byName: Readonly<Record<string, Kind>> = Rec.fromEntries(Arr.map(kinds, (kind) => [kind.name, kind] as const))
  const matches = matchesWith(Arr.map(kinds, (kind) => kind.name), tokenizerFor(options).textCountOf)
  return {
    name: "complex",
    codec: complexStringWith(options),
    blend: (from, to) =>
      Bool.match(matches(from, to), {
        onTrue: () => Option.map(slotsOf(byName, from, to), (slots) => blendSlots(to.parts, slots)),
        onFalse: () => Option.none(),
      }),
  }
}

/** The complex value Interpolator with no text spans and no kinds: core's default (see {@link complexWith}). */
export const complex: Entry<Complex, string> = complexWith({})

/**
 * The interpolators core ships with, in resolution order. `number` and `array` are checked first
 * (cheap, unambiguous); `unit` before `complex` so `"10px"` routes to unit; `complex` LAST so it
 * only catches strings with numbers among other text (SVG `d`/`points`, `filter`, `box-shadow`)
 * the specific entries didn't claim (ADR-0015). An Environment adds its own kinds among them (the
 * DOM's colours, before `unit`; ADR-0036).
 */
export const defaults: ReadonlyArray<Entry<any, any>> = [number, array, unit, complex]
