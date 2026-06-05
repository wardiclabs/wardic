/// <reference path="../culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
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
const hasColorPrefix = (trimmed: string): boolean => {
  if (trimmed.length === 0) return false
  if (trimmed.charCodeAt(0) === 35 /* '#' */) return true
  const head = trimmed.slice(0, 5).toLowerCase()
  return (
    head.startsWith("rgb(") ||
    head.startsWith("rgba(") ||
    head.startsWith("hsl(") ||
    head.startsWith("hsla(")
  )
}

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
  match: (value) => {
    if (typeof value !== "string") return false
    const trimmed = value.trim()
    if (hasColorPrefix(trimmed)) return true
    return culoriParse(trimmed) !== undefined
  },
  interpolate: (from, to, t) => formatRgb(culoriInterpolate([from, to], mode)(t)),
})
