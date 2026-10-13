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

/** A complex value's tokens. A colour matches whole from its first character (`#`, `r`, `h`), where no number can start, so its channels aren't read as numbers. */
export const TOKEN_RE = new RegExp(`${COLOR_TOKEN}|${NUMBER_TOKEN}`, "gi")

/** A token that starts like a colour (`#`, `rgb(`, `hsl(`), not like a number. */
export const COLOR_START_RE = /^[#a-z]/i

/** A token that is a number, not a colour. */
const isNumberToken: Predicate.Predicate<string> = (token) => !COLOR_START_RE.test(token)

/** How many numbers a string holds outside its colours: what complex matching counts. */
export const numberCountOf = (input: string): number =>
  Arr.filter(Option.getOrElse(Str.match(TOKEN_RE)(input), (): ReadonlyArray<string> => []), isNumberToken).length
