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
 * Interpolates a numeric value carrying a unit suffix, e.g. `"10px" → "20px"`,
 * `"0%" → "100%"`. The unit is taken from whichever endpoint has one.
 */
export const unitInterpolator: InterpolatorEntry<string> = {
  name: "unit",
  match: (value) => typeof value === "string" && parse(value) !== undefined,
  interpolate: (from, to, t) => {
    const a = parse(from)
    const b = parse(to)
    if (a === undefined || b === undefined) return t < 1 ? from : to
    return `${lerp(a.value, b.value, t)}${a.unit || b.unit}`
  },
}
