/**
 * The DOM Environment's colours (ADR-0036; ADR-0026 for the Interpolator's shape): CSS Color syntax,
 * parsed and blended through culori. Core names no colour syntax; `@wardic/dom` registers its
 * colour Interpolator in its registry (`interpolators.ts`) and names a colour inside a complex value
 * as a kind of token (`COLOR_TOKEN`, #61).
 *
 * @module
 */
/// <reference path="./culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import * as Interpolator from "@wardic/core/Interpolator"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

/**
 * A colour as culori holds it: its colour space (`mode`) and its channels. The DOM's own type, so
 * the declarations it emits don't lean on `culori.d.ts`.
 */
export type Color = { readonly mode: string; readonly [channel: string]: number | string | undefined }

/** A culori colour: an object tagged with its colour space. */
const isColor = (value: unknown): value is Color => Predicate.hasProperty(value, "mode")

/**
 * culori's `parse`, with a throw read as no colour. It throws on a CSS function holding a length,
 * `blur(4px)`, `inset(10px)`, `drop-shadow(0px 0px 4px red)`, and the throw escaped the codec's
 * decode at `resolve`, so the leg failed (#154).
 */
const culoriParseOption = Option.liftThrowable(culoriParse)

/** Parse a colour string, trimmed, or `None` when culori rejects it (`"auto"`, `"#zzz"`) or throws on it (`"blur(4px)"`). */
const parseColor = (input: string): Option.Option<Color> =>
  Option.filter(Option.flatMap(culoriParseOption(Str.trim(input)), Option.fromUndefinedOr), isColor)

/**
 * A colour string (ADR-0026; CONTEXT.md's "color string") ↔ a culori colour. A string is a colour
 * iff culori's `parse` accepts it, trimmed. It encodes as `rgb(…)` / `rgba(…)` with culori's
 * `formatRgb`, the function the frame calls, so `"#000"` round-trips to `"rgb(0, 0, 0)"`.
 */
export const ColorString: Schema.Codec<Color, string> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare(isColor),
    Interpolator.parseAndFormat(parseColor, (color: Color): string => formatRgb(color)),
  ),
)

/**
 * Interpolates colours via culori (ADR-0026). `mode` is the colour space the blend runs in:
 * `"rgb"` by default (sRGB, as WAAPI blends, ADR-0024); pass `"oklch"` / `"lab"` for perceptual
 * blends.
 *
 * Built as a factory so an app can register the space it prefers, over the one `ColorString`
 * codec; the DOM's registry uses `"rgb"` (`cssColor`). A string is a colour iff culori parses it,
 * trimmed, so CSS keywords like `"auto"` / `"inherit"` aren't, and named colours and modern forms
 * culori supports are.
 *
 * `blend` builds culori's interpolator once, when a stream is built, and the frame calls it and
 * formats with `formatRgb`, the codec's encode. Culori returns a new colour object on each call,
 * which no blend through culori avoids, and clamps `t` to [0, 1], so past 1 a colour holds at its
 * target (ADR-0024, decision 5).
 */
export const color = (mode = "rgb"): Interpolator.Entry<Color, string> => ({
  name: `color(${mode})`,
  codec: ColorString,
  blend: (from, to) => {
    const at = culoriInterpolate([from, to], mode)
    return Option.some((t: number) => formatRgb(at(t)))
  },
})

/**
 * A colour inside a complex value: a hex, or an `rgb()`, `rgba()`, `hsl()` or `hsla()` (Motion's
 * colour token, motion-dom value/types/utils/color-regex.ts at 16c6122). A named colour (`red`)
 * isn't one: it stays part of the text around the tokens (#61).
 */
export const COLOR_TOKEN = /#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)/

/** The DOM's colours: CSS Color syntax, blended in sRGB as WAAPI blends (ADR-0024), its registry's colour tier. */
export const cssColor: Interpolator.Entry<Color, string> = color("rgb")
