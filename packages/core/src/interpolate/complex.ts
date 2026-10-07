import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

/** A single number token: optional sign, int/decimal, optional exponent. */
const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi

/** Sentinel marking a number's slot in the template (a control char absent from real values). */
const SLOT = "\x00"

interface Parsed {
  /** The string with every number replaced by {@link SLOT} — the structural skeleton. */
  readonly template: string
  /** The embedded numbers, in document order. */
  readonly numbers: ReadonlyArray<number>
}

/** Split a string into its non-numeric template + ordered numbers. */
const parse = (input: string): Parsed => {
  const numbers: Array<number> = []
  const template = input.replace(NUMBER_RE, (m) => {
    numbers.push(Number.parseFloat(m))
    return SLOT
  })
  return { template, numbers }
}

/** Count numeric tokens in a string. */
const numberCount = (input: string): number => input.match(NUMBER_RE)?.length ?? 0

/**
 * Generic "complex value" interpolator (Motion's complex value type): a string
 * carrying ≥2 embedded numbers — an SVG `d`/`points`, a `filter`, a multi-part
 * `box-shadow`, … — interpolated number-by-number WHEN both endpoints share the
 * same non-numeric template (identical structure + number count). On a template
 * mismatch it can't blend: a Discrete pair, which snaps to `to` at the first frame
 * past 0 (ADR-0024, amending ADR-0015's snap at `t=1`).
 *
 * This is the **same-structure tier of path morphing** (ADR-0015): two `d`/`points`
 * with the same command sequence morph for free. **Arbitrary-structure** morphing
 * (aligning paths with *different* command counts) is a separate, opt-in, heavier
 * interpolator (`@wardic/path-morph`, deferred) — registered at higher precedence
 * when wanted; it never enters the default bundle.
 *
 * Registered LAST so the specific interpolators win: `"10px"` → unit (a single
 * number), `"#fff"`/`"rgb(…)"` → color (matched earlier), and only genuinely
 * multi-number structural strings land here.
 *
 * Known limit (as Motion, without a path normalizer): SVG arc flags in an `A`/`a`
 * command are treated as plain numbers, so an arc path can interpolate through
 * invalid flag values — same-structure `M/L/C/S/Q/T/Z` morphing is sound.
 */
export const complexInterpolator: InterpolatorEntry<string> = {
  name: "complex",
  match: (value) => typeof value === "string" && numberCount(value) >= 2,
  interpolate: (from, to, t) => {
    const a = parse(from)
    const b = parse(to)
    if (a.template !== b.template || a.numbers.length !== b.numbers.length) {
      return t > 0 ? to : from // structure mismatch → a Discrete pair, switched at the first frame (ADR-0024; tier-2 territory)
    }
    const parts = a.template.split(SLOT) // length === numbers.length + 1
    let out = parts[0]!
    for (let i = 0; i < a.numbers.length; i++) {
      out += String(lerp(a.numbers[i]!, b.numbers[i]!, t)) + parts[i + 1]!
    }
    return out
  },
}
