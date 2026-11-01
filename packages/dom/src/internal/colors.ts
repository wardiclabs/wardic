/**
 * The DOM Environment's colours (ADR-0036; ADR-0026 for the Interpolator's shape): CSS Color syntax,
 * parsed through culori, and blended in sRGB by Wardic's own lerp and format, which write culori's
 * strings (ADR-0026 *Amendment (#156)*). Core names no colour syntax; `@wardic/dom` registers its
 * colour Interpolator in its registry (`interpolators.ts`) and names a colour inside a complex value
 * as a kind of token (`COLOR_TOKEN`, #61).
 *
 * @module
 */
/// <reference path="./culori.d.ts" />
import { converter, formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import type * as Interpolator from "@wardic/core/Interpolator"
import * as Scalar from "@wardic/core/Scalar"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * A colour as culori holds it: its colour space (`mode`) and its channels. The DOM's own type, so
 * the declarations it emits don't lean on `culori.d.ts`.
 */
export type Color = { readonly mode: string; readonly [channel: string]: number | string | undefined }

/** A culori colour: an object tagged with its colour space. */
const isColor = (value: unknown): value is Color => Predicate.hasProperty(value, "mode")

/**
 * culori's `parse`, with a throw read as no colour. It throws on a CSS function holding a length,
 * `blur(4px)`, `inset(10px)`, `drop-shadow(0px 0px 4px red)`, and the throw escaped the colour's
 * decode at `resolve`, so the leg failed (#154).
 */
const culoriParseOption = Option.liftThrowable(culoriParse)

/** Parse a colour string, trimmed, or `None` when culori rejects it (`"auto"`, `"#zzz"`) or throws on it (`"blur(4px)"`). */
const parseColorString = (input: string): Option.Option<Color> =>
  Option.filter(Option.flatMap(culoriParseOption(Str.trim(input)), Option.fromUndefinedOr), isColor)

/**
 * A colour string read (ADR-0026; CONTEXT.md's "color string"): a culori colour, or `None` for any
 * other value. A string is a colour iff culori's `parse` accepts it, trimmed. `Color.parse`, and
 * the colour Interpolator's `parse` (plain functions since #511, where they were a Schema codec,
 * `ColorString`).
 */
export const parseColor = (value: unknown): Option.Option<Color> => {
  if (!Predicate.isString(value)) return Option.none()
  return parseColorString(value)
}

/**
 * A colour written as `rgb(…)` / `rgba(…)` with culori's `formatRgb`, the function the frame
 * calls, so `"#000"` reads and writes back as `"rgb(0, 0, 0)"`. `Color.format`, and the colour
 * Interpolator's `format`.
 */
export const formatColor = (color: Color): string => formatRgb(color)

// --- sRGB, Wardic's own (#156, ADR-0026 *Amendment (#156)*) ------------------------------------
//
// culori's `formatRgb(interpolate([from, to], "rgb")(t))`, string for string, without a colour
// object per frame. Its path, at culori 4.0.2: `t` clamped to [0, 1]; at `t <= 0` the start as
// converted; a channel one end lacks (CSS `none`) takes the other end's; an alpha one end lacks is
// 1 when the other has one (`fixupAlpha`); each channel lerped `a + t * (b - a)` (`Scalar.lerp`'s
// `a + (b - a) * t`, the same bits: multiplication commutes); then each channel byte is
// `round(clamp(v || 0) * 255)`, and `rgb()` is written when alpha is absent or exactly 1, else
// `rgba()` with alpha clamped and rounded to two places, so 0.999 writes `rgba(…, 1)`. A seeded
// differential test against culori pins it (`colors.node.test.ts`).

const toRgb = converter("rgb")

/** A colour's four channels, resolved once: what the frame lerps. */
interface Channels {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly alpha: number
}

/**
 * One channel of a pair, as culori's piecewise interpolator reads it: both ends, or the end that
 * has it, twice. One neither end has is 0 on both: culori leaves it out, and its format writes 0.
 */
const channelPair = (a: number | undefined, b: number | undefined): readonly [number, number] =>
  UndefinedOr.match(a, {
    onUndefined: () => UndefinedOr.match(b, { onUndefined: () => [0, 0] as const, onDefined: (y) => [y, y] as const }),
    onDefined: (x) => UndefinedOr.match(b, { onUndefined: () => [x, x] as const, onDefined: (y) => [x, y] as const }),
  })

/** An alpha one end lacks is 1, culori's `fixupAlpha`; with neither, 1 on both writes `rgb()`, as culori does. */
const alphaOf = (alpha: number | undefined): number => UndefinedOr.match(alpha, { onUndefined: () => 1, onDefined: identity })

/** A channel's value at 0–1, as culori's format reads it: NaN as 0, then clamped. Per frame: an early return. */
const unitOf = (value: number): number => {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/** A channel as a byte, as culori's `formatRgb` writes it. */
const byteOf = (value: number): number => Math.round(unitOf(value) * 255)

/** An alpha as culori's `formatRgb` writes it: clamped, two decimal places. */
const alphaText = (alpha: number): number => Math.round(unitOf(alpha) * 100) / 100

/** Four channels as culori's `formatRgb` writes them. Per frame: an early return. */
const formatChannels = (r: number, g: number, b: number, alpha: number): string => {
  if (alpha === 1) return `rgb(${byteOf(r)}, ${byteOf(g)}, ${byteOf(b)})`
  return `rgba(${byteOf(r)}, ${byteOf(g)}, ${byteOf(b)}, ${alphaText(alpha)})`
}

/**
 * Two colours' blend in sRGB, on the per-frame path (ADR-0025): `t` clamped as culori clamps it,
 * the start as written at `t <= 0`, and the four lerps formatted. Nothing allocated but the string.
 */
const blendChannels =
  (atStart: string, from: Channels, to: Channels) =>
  (t: number): string => {
    const at = Math.min(Math.max(0, t), 1)
    if (at <= 0) return atStart
    return formatChannels(
      Scalar.lerp(from.r, to.r, at),
      Scalar.lerp(from.g, to.g, at),
      Scalar.lerp(from.b, to.b, at),
      Scalar.lerp(from.alpha, to.alpha, at),
    )
  }

/**
 * Two ends with the same channels: every `t` past 0 writes one string, since `a + t * (a - a)` is
 * `a` (#156). Per frame: an early return.
 */
const holdChannels =
  (atStart: string, same: string) =>
  (t: number): string => {
    if (t <= 0) return atStart
    return same
  }

/** Two channels that are the same on both ends. */
const isSame = ([a, b]: readonly [number, number]): boolean => a === b

/**
 * Two colours' sRGB blend, resolved once when a stream is built: each end converted to sRGB by
 * culori, its channels paired as culori pairs them, and the start's own string for `t <= 0`, by
 * culori's `formatRgb` itself. Two ends with the same channels hold one string.
 */
const srgb = (from: Color, to: Color): ((t: number) => string) => {
  const a = toRgb(from)
  const b = toRgb(to)
  const pairs = [
    channelPair(a.r as number | undefined, b.r as number | undefined),
    channelPair(a.g as number | undefined, b.g as number | undefined),
    channelPair(a.b as number | undefined, b.b as number | undefined),
    [alphaOf(a.alpha as number | undefined), alphaOf(b.alpha as number | undefined)] as const,
  ] as const
  const [[fr, tr], [fg, tg], [fb, tb], [fa, ta]] = pairs
  const atStart = formatRgb(a)
  return Bool.match(Arr.every(pairs, isSame), {
    onTrue: () => holdChannels(atStart, formatChannels(fr, fg, fb, fa)),
    onFalse: () => blendChannels(atStart, { r: fr, g: fg, b: fb, alpha: fa }, { r: tr, g: tg, b: tb, alpha: ta }),
  })
}

/** Two colours' blend through culori in `mode`: `interpolate` once, then a colour object and `formatRgb` per frame. */
const throughCulori = (mode: string, from: Color, to: Color): ((t: number) => string) => {
  const at = culoriInterpolate([from, to], mode)
  return (t: number) => formatRgb(at(t))
}

/**
 * Interpolates colours (ADR-0026). `mode` is the colour space the blend runs in: `"rgb"` by default
 * (sRGB, as WAAPI blends, ADR-0024); pass `"oklch"` / `"lab"` for perceptual blends.
 *
 * Built as a factory so an app can register the space it prefers, over the one `parseColor` and
 * `formatColor`; the DOM's registry uses `"rgb"` (`cssColor`). A string is a colour iff culori
 * parses it, trimmed, so CSS keywords like `"auto"` / `"inherit"` aren't, and named colours and
 * modern forms culori supports are.
 *
 * `blend` resolves the pair once, when a stream is built, and the frame writes the string `format`
 * (`formatRgb`) would:
 * - **`"rgb"`** blends with Wardic's own lerp and format (#156, ADR-0026 *Amendment (#156)*), the
 *   strings culori writes, with no colour object per frame; two ends of the same colour write one
 *   string.
 * - **Any other mode** goes through culori's interpolator, which returns a new colour object on
 *   each call.
 *
 * Either clamps `t` to [0, 1], as culori does, so past 1 a colour holds at its target (ADR-0024,
 * decision 5).
 */
export const color = (mode = "rgb"): Interpolator.Entry<Color, string> => ({
  name: `color(${mode})`,
  parse: parseColor,
  format: formatColor,
  blend: (from, to) =>
    Option.some(
      Bool.match(mode === "rgb", {
        onTrue: () => srgb(from, to),
        onFalse: () => throughCulori(mode, from, to),
      }),
    ),
})

/**
 * A colour inside a complex value: a hex, or an `rgb()`, `rgba()`, `hsl()` or `hsla()` (Motion's
 * colour token, motion-dom value/types/utils/color-regex.ts at 16c6122). A named colour (`red`)
 * isn't one: it stays part of the text around the tokens (#61).
 */
export const COLOR_TOKEN = /#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)/

/** The DOM's colours: CSS Color syntax, blended in sRGB as WAAPI blends (ADR-0024), its registry's colour tier. */
export const cssColor: Interpolator.Entry<Color, string> = color("rgb")
