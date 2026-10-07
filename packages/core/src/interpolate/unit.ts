import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

const UNIT_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i

interface ParsedUnit {
  readonly value: number
  readonly unit: string
}

const parse = (input: string): ParsedUnit | undefined => {
  const match = UNIT_RE.exec(input.trim())
  if (match === null) return undefined
  return { value: Number.parseFloat(match[1]!), unit: match[2] ?? "" }
}

/**
 * The unit of a number-with-unit string as the `unit` interpolator parses it (`""` for a bare
 * number), or `undefined` when `value` isn't one (`"auto"`, a colour). Two strings whose units
 * are both non-empty and differ are a pair the registry dies on (registry.ts `bind`).
 */
export const unitOf = (value: string): string | undefined => parse(value)?.unit

/**
 * Interpolates a numeric value carrying a unit suffix, e.g. `"10px" → "20px"`,
 * `"0%" → "100%"`. The unit is taken from whichever endpoint has one.
 */
export const unitInterpolator: InterpolatorEntry<string> = {
  name: "unit",
  match: (value) => typeof value === "string" && parse(value) !== undefined,
  interpolate: (from, to, t) => {
    const a = parse(from)
    const b = parse(to)
    if (a === undefined || b === undefined) return t > 0 ? to : from // a Discrete pair (ADR-0024)
    return `${lerp(a.value, b.value, t)}${a.unit || b.unit}`
  },
}
