/// <reference path="../culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { parseAndFormat } from "./codec.ts"

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
    parseAndFormat(parseColor, (color: Color): string => formatRgb(color), "a colour culori parses"),
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
export const colorInterpolator = (mode = "rgb"): InterpolatorEntry<Color, string> => ({
  name: `color(${mode})`,
  codec: ColorString,
  blend: (from, to) => {
    const at = culoriInterpolate([from, to], mode)
    return Option.some((t: number) => formatRgb(at(t)))
  },
})
