/**
 * A complex value's tokens (#61, ADR-0015 *Amendment (#61)*): the regexes `Interpolator`'s
 * `ComplexString` decodes with, and a cheap count of a string's numbers for the shadow rule
 * (`internal/animatableNone.ts`), which needs no decode. Not importable from outside core
 * (`package.json`'s `"./internal/*": null`).
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"

/**
 * A colour inside a complex value: a hex, or an `rgb()`, `rgba()`, `hsl()` or `hsla()` (Motion's
 * colour token, motion-dom value/types/utils/color-regex.ts at 16c6122). A named colour (`red`)
 * isn't one: it stays part of the text around the tokens.
 */
const COLOR_TOKEN = String.raw`#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)`

/** A single number token: optional sign, int/decimal, optional exponent. */
const NUMBER_TOKEN = String.raw`-?\d*\.?\d+(?:e[-+]?\d+)?`

/**
 * A reference to a custom property, `var(--name)`, with a fallback one bracket level deep (#158;
 * Motion's var token, motion-dom value/types/complex/index.ts `complexRegex` at 16c6122). It's
 * matched whole, so the digits in its name (`--gray-500`) are never numbers, and a complex value
 * keeps it as text.
 */
const VAR_TOKEN = String.raw`var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)`

/**
 * A complex value's tokens. A `var()` and a colour each match whole from their first character
 * (`v`; `#`, `r`, `h`), where no number can start, so neither's digits are read as numbers.
 */
export const TOKEN_RE = new RegExp(`${VAR_TOKEN}|${COLOR_TOKEN}|${NUMBER_TOKEN}`, "gi")

/** Every `var()` in a string: what complex matching counts besides numbers and colours. */
const VAR_RE = new RegExp(VAR_TOKEN, "gi")

/** A token that is a `var()`: text, not a number or a colour. */
export const VAR_START_RE = /^var\s*\(/i

/** A token that starts like a colour (`#`, `rgb(`, `hsl(`), not like a number; check `VAR_START_RE` first. */
export const COLOR_START_RE = /^[#a-z]/i

/** A token that is a number: not a `var()` or a colour. */
const isNumberToken: Predicate.Predicate<string> = (token) => !COLOR_START_RE.test(token)

/** How many `var()`s a string holds. */
export const varCountOf = (input: string): number => Option.getOrElse(Option.map(Str.match(VAR_RE)(input), (vars) => vars.length), () => 0)

/** How many numbers a string holds outside its colours: what complex matching counts. */
export const numberCountOf = (input: string): number =>
  Arr.filter(Option.getOrElse(Str.match(TOKEN_RE)(input), (): ReadonlyArray<string> => []), isNumberToken).length
