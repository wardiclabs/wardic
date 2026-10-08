/// <reference path="../culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import { pipe } from "effect/Function"
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
 * Cheap prefix fast-path — recognises the syntactically-unambiguous CSS color
 * forms without ever touching culori. Matches the leading token of `#hex`,
 * `rgb(`, `rgba(`, `hsl(`, `hsla(` after trimming and lower-casing the prefix.
 *
 * Anything else (named CSS colors like `"rebeccapurple"`, CSS keywords like
 * `"auto"`/`"none"`/`"inherit"`, modern color forms like `lab()`/`oklch()`) is
 * left to `culori.parse` so the matcher only accepts strings culori actually
 * understands.
 */
const hasColorPrefix: Predicate.Predicate<string> = Predicate.or(
  Str.startsWith("#"),
  Predicate.mapInput(
    Predicate.some([Str.startsWith("rgb("), Str.startsWith("rgba("), Str.startsWith("hsl("), Str.startsWith("hsla(")]),
    (trimmed: string) => pipe(trimmed, Str.slice(0, 5), Str.toLowerCase),
  ),
)

/** A string culori parses: a named colour, `lab()`, `oklch()`, … */
const parsesAsColor: Predicate.Predicate<string> = (trimmed) => Predicate.isNotUndefined(culoriParse(trimmed))

/** A colour string: by its prefix, else by culori's parse. */
const isColorString: Predicate.Predicate<unknown> = Predicate.compose(
  Predicate.isString,
  Predicate.mapInput(Predicate.or(hasColorPrefix, parsesAsColor), Str.trim),
)

/**
 * Interpolates CSS color strings via culori. `mode` is the interpolation color
 * space — default `"rgb"` (fast); pass `"oklch"` / `"lab"` for perceptual blends.
 *
 * Built as a factory so an environment can register the space it prefers; the
 * default registry uses `"rgb"`.
 *
 * `match` is two-tiered: a syntactic prefix check (`#`, `rgb(`, `rgba(`,
 * `hsl(`, `hsla(`) returns `true` without any parsing, and anything that
 * misses the fast-path falls through to `culori.parse` — a string is a color
 * iff culori can parse it. This keeps CSS keywords like `"auto"`/`"inherit"`
 * out (they're not colors) while still admitting named colors and modern
 * color forms culori supports.
 */
export const colorInterpolator = (mode = "rgb"): InterpolatorEntry<string> => ({
  name: `color(${mode})`,
  match: isColorString,
  interpolate: (from, to, t) => formatRgb(culoriInterpolate([from, to], mode)(t)),
})
