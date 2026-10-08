import * as Arr from "effect/Array"
import * as Equivalence from "effect/Equivalence"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { parseAndFormat } from "./codec.ts"
import { discrete } from "./discrete.ts"

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
const numberCount = (input: string): number =>
  pipe(input, Str.match(NUMBER_RE), Option.match({ onNone: () => 0, onSome: (tokens) => tokens.length }))

/** A string carrying two or more numbers. */
const isComplexString: Predicate.Predicate<unknown> = Predicate.compose(Predicate.isString, (value: string) =>
  numberCount(value) >= 2,
)

/**
 * A complex value, decoded (CONTEXT.md): the pieces around its numbers, and the numbers, in
 * document order. `parts.length === numbers.length + 1`.
 */
type Complex = { readonly parts: ReadonlyArray<string>; readonly numbers: ReadonlyArray<number> }

/** Two or more numeric tokens: what makes a string a complex value. */
const twoOrMore: Predicate.Predicate<ReadonlyArray<string>> = (tokens) => tokens.length >= 2

/** Parse a complex value: a string carrying two or more numbers, or `None`. */
const parseComplex = (input: string): Option.Option<Complex> =>
  pipe(
    input,
    Str.match(NUMBER_RE),
    Option.filter(twoOrMore),
    Option.map((tokens) => ({
      parts: Str.split(input, NUMBER_RE),
      numbers: Arr.map(tokens, (token) => Number.parseFloat(token)),
    })),
  )

/**
 * A complex value's parts and numbers, interleaved: the complex codec's plain encode (ADR-0026).
 * On the per-frame path: a counted loop, and nothing allocated but the string.
 */
const formatComplex = (parts: ReadonlyArray<string>, numbers: ReadonlyArray<number>): string => {
  let out = Arr.getUnsafe(parts, 0)
  for (let i = 0; i < numbers.length; i++) out += String(Arr.getUnsafe(numbers, i)) + Arr.getUnsafe(parts, i + 1)
  return out
}

/**
 * A complex value (ADR-0015, ADR-0026; CONTEXT.md) ↔ its parts and numbers: a string carrying two
 * or more numbers, an SVG `d` or `points`, a `filter`, a multi-part `box-shadow`. It encodes with
 * `formatComplex`, the function the frame calls; numbers come back in JavaScript's shortest form,
 * so `"M0.50,1e3"` encodes back as `"M0.5,1000"`.
 */
export const ComplexString: Schema.Codec<Complex, string> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Struct({ parts: Schema.Array(Schema.String), numbers: Schema.Array(Schema.Number) }),
    parseAndFormat(
      parseComplex,
      (complex: Complex): string => formatComplex(complex.parts, complex.numbers),
      "a string carrying two or more numbers",
    ),
  ),
)

/** Two parsed strings of one structure: the same template, and as many numbers. */
const sameStructure: Equivalence.Equivalence<Parsed> = Equivalence.Struct({
  template: Equivalence.String,
  numbers: Equivalence.mapInput(Equivalence.Number, (numbers: ReadonlyArray<number>) => numbers.length),
})

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
 *
 * `interpolate` is on the per-frame path (ADR-0025): an early return for the Discrete pair,
 * and a counted loop over the numbers. It still parses both strings on every call (#65).
 */
export const complexInterpolator: InterpolatorEntry<string> = {
  name: "complex",
  match: isComplexString,
  interpolate: (from, to, t) => {
    const a = parse(from)
    const b = parse(to)
    // A structure mismatch is a Discrete pair, switched at the first frame (ADR-0024; tier-2 territory).
    if (!sameStructure(a, b)) return discrete(from, to, t)
    const parts = a.template.split(SLOT) // length === numbers.length + 1
    let out = Arr.getUnsafe(parts, 0)
    for (let i = 0; i < a.numbers.length; i++) {
      out += String(lerp(Arr.getUnsafe(a.numbers, i), Arr.getUnsafe(b.numbers, i), t)) + Arr.getUnsafe(parts, i + 1)
    }
    return out
  },
}
