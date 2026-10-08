/// <reference path="../culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import { pipe } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

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
