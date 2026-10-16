/**
 * The DOM Environment's complex values (ADR-0035 *Amendment (#158)*, ADR-0036): core's complex tier,
 * given CSS's `var()` as a span of text (#158) and a colour as a kind of token (#61, #160). Core
 * names neither.
 *
 * @module
 */
import * as Interpolator from "@wardic/core/Interpolator"
import { COLOR_TOKEN, cssColor } from "./colors.ts"

/**
 * A reference to a custom property, `var(--name)`, with a fallback one bracket level deep (Motion's
 * var token, motion-dom value/types/complex/index.ts `complexRegex` at 16c6122). Inside a complex
 * value it's text: the digits in its name (`--gray-500`) are never numbers (#158).
 */
export const VARIABLE_REFERENCE = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)/

/**
 * Core's complex Interpolator with the DOM's syntax:
 * - a `var()` is text (#158): a lone `var()` isn't a complex value, and two blend only with the same
 *   count of `var()`s, the target's written as it stands;
 * - a colour is a token (#61, #160) that blends through `cssColor`, in sRGB, so a shadow's colour
 *   fades: two blend only with the same count of colours, the n-th with the n-th, and a lone colour
 *   is `cssColor`'s, not a complex value.
 */
export const cssComplex: Interpolator.Entry<Interpolator.Complex, string> = Interpolator.complexWith({
  text: [VARIABLE_REFERENCE],
  tokens: [{ pattern: COLOR_TOKEN, entry: cssColor }],
})
