/**
 * A complex value's tokens (#61, ADR-0015 *Amendment (#61)*): the regexes `Interpolator`'s complex
 * codecs decode with. Environment-neutral (ADR-0036): an Environment names the spans that are only
 * text in its values (#158, ADR-0035 *Amendment (#158)*) and its kinds of token besides numbers
 * (#160), matched in that order and before numbers, so the digits in a span or a token are never
 * numbers. Not importable from outside core (`package.json`'s `"./internal/*": null`).
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Str from "effect/String"

/** A single number token: optional sign, int/decimal, optional exponent. */
const NUMBER_TOKEN = String.raw`-?\d*\.?\d+(?:e[-+]?\d+)?`

/** How a complex codec reads tokens, given its Environment's text spans and kinds. Built once per codec. */
export interface Tokenizer {
  /** A complex value's tokens: the text spans first, then each kind's tokens, then numbers. */
  readonly tokenRe: RegExp
  /** Whether a matched token is one of the text spans. */
  readonly isText: (token: string) => boolean
  /** Which kind a matched token is, by its place among the kinds given; `None` for a number. */
  readonly kindOf: (token: string) => Option.Option<number>
  /** How many text spans a string holds: what complex matching counts besides numbers and kinds. */
  readonly textCountOf: (input: string) => number
}

/** A pattern that matches a token whole, case-insensitively. */
const wholeOf = (source: string): RegExp => new RegExp(`^(?:${source})$`, "i")

/**
 * A tokenizer for `text`, the spans an Environment names as only text, and `kinds`, the patterns
 * of its kinds of token. A text span matches whole, before a kind's token, and a kind's token
 * before a number, so none reads into the one before it. With neither, a string's digits are all
 * numbers.
 */
export const tokenizerOf = (text: ReadonlyArray<RegExp>, kinds: ReadonlyArray<RegExp>): Tokenizer => {
  const sources = Arr.map(text, (pattern) => pattern.source)
  const kindSources = Arr.map(kinds, (pattern) => pattern.source)
  const whole = Arr.map(sources, wholeOf)
  const wholeKinds = Arr.map(kindSources, wholeOf)
  const any = Arr.match(sources, {
    onEmpty: () => Option.none<RegExp>(),
    onNonEmpty: (all) => Option.some(new RegExp(Arr.join(all, "|"), "gi")),
  })
  return {
    tokenRe: new RegExp(Arr.join([...sources, ...kindSources, NUMBER_TOKEN], "|"), "gi"),
    isText: (token) => Arr.some(whole, (pattern) => pattern.test(token)),
    kindOf: (token) => Arr.findFirstIndex(wholeKinds, (pattern) => pattern.test(token)),
    textCountOf: (input) =>
      Option.getOrElse(
        Option.flatMap(any, (pattern) => Option.map(Str.match(pattern)(input), (spans) => spans.length)),
        () => 0,
      ),
  }
}
