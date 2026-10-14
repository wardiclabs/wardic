/**
 * A complex value's tokens (#61, ADR-0015 *Amendment (#61)*): the regexes `Interpolator`'s complex
 * codecs decode with. Environment-neutral: an Environment names the spans that are only text in
 * its values, and they're matched before colours and numbers, so the
 * digits in them are never numbers (#158, ADR-0035 *Amendment (#158)*). Not importable from
 * outside core (`package.json`'s `"./internal/*": null`).
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Str from "effect/String"

/**
 * A colour inside a complex value: a hex, or an `rgb()`, `rgba()`, `hsl()` or `hsla()` (Motion's
 * colour token, motion-dom value/types/utils/color-regex.ts at 16c6122). A named colour (`red`)
 * isn't one: it stays part of the text around the tokens.
 */
const COLOR_TOKEN = String.raw`#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)`

/** A single number token: optional sign, int/decimal, optional exponent. */
const NUMBER_TOKEN = String.raw`-?\d*\.?\d+(?:e[-+]?\d+)?`

/** A token that starts like a colour (`#`, `rgb(`, `hsl(`), not like a number; check for a text span first. */
export const COLOR_START_RE = /^[#a-z]/i

/** How a complex codec reads tokens, given the spans its Environment names as text. Built once per codec. */
export interface Tokenizer {
  /** A complex value's tokens: the text spans first, then colours, then numbers. */
  readonly tokenRe: RegExp
  /** Whether a matched token is one of the text spans. */
  readonly isText: (token: string) => boolean
  /** How many text spans a string holds: what complex matching counts besides numbers and colours. */
  readonly textCountOf: (input: string) => number
}

/**
 * A tokenizer for `text`, the spans an Environment names as only text. A text span matches whole,
 * before a colour or a number, so neither reads into it. With none, a string's digits are all
 * numbers or colours' channels.
 */
export const tokenizerOf = (text: ReadonlyArray<RegExp>): Tokenizer => {
  const sources = Arr.map(text, (pattern) => pattern.source)
  const whole = Arr.map(sources, (source) => new RegExp(`^(?:${source})$`, "i"))
  const any = Arr.match(sources, {
    onEmpty: () => Option.none<RegExp>(),
    onNonEmpty: (all) => Option.some(new RegExp(Arr.join(all, "|"), "gi")),
  })
  return {
    tokenRe: new RegExp(Arr.join([...sources, COLOR_TOKEN, NUMBER_TOKEN], "|"), "gi"),
    isText: (token) => Arr.some(whole, (pattern) => pattern.test(token)),
    textCountOf: (input) =>
      Option.getOrElse(
        Option.flatMap(any, (pattern) => Option.map(Str.match(pattern)(input), (spans) => spans.length)),
        () => 0,
      ),
  }
}
