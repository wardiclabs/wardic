import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { parseAndFormat } from "./codec.ts"

/** A single number token: optional sign, int/decimal, optional exponent. */
const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi

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

/** Two complex values of one structure: the same parts around their numbers, so as many numbers. */
const sameStructure: Equivalence.Equivalence<Complex> = Equivalence.mapInput(
  Arr.makeEquivalence(Equivalence.String),
  (complex: Complex) => complex.parts,
)

/**
 * Two complex values' blend, number by number. The frame writes the lerped numbers into one array
 * allocated here, once, and interleaves them with the parts through `formatComplex`, the codec's
 * encode: a counted loop, and nothing allocated per frame but the string.
 */
const blendNumbers = (from: Complex, to: Complex): ((t: number) => string) => {
  const numbers = Arr.copy(from.numbers)
  return (t) => {
    for (let i = 0; i < numbers.length; i++) {
      numbers[i] = lerp(Arr.getUnsafe(from.numbers, i), Arr.getUnsafe(to.numbers, i), t)
    }
    return formatComplex(from.parts, numbers)
  }
}

/**
 * Generic "complex value" interpolator (Motion's complex value type): a string
 * carrying ≥2 embedded numbers — an SVG `d`/`points`, a `filter`, a multi-part
 * `box-shadow`, … — interpolated number-by-number WHEN both endpoints share the
 * same structure (the same parts around the same count of numbers). Two of
 * different structures can't blend: `None`, a Discrete pair, which `resolve`
 * switches to `to` at the first frame past 0 and warns about (ADR-0024, ADR-0026).
 *
 * This is the **same-structure tier of path morphing** (ADR-0015): two `d`/`points`
 * with the same command sequence morph for free. **Arbitrary-structure** morphing
 * (aligning paths with *different* command counts) is a separate, opt-in, heavier
 * interpolator (`@wardic/path-morph`, deferred) — registered at higher precedence
 * when wanted; it never enters the default bundle.
 *
 * Registered LAST so the specific interpolators win: `"10px"` → unit (a single
 * number), `"#fff"`/`"rgb(…)"` → color (decoded earlier), and only genuinely
 * multi-number structural strings land here.
 *
 * Known limit (as Motion, without a path normalizer): SVG arc flags in an `A`/`a`
 * command are treated as plain numbers, so an arc path can interpolate through
 * invalid flag values — same-structure `M/L/C/S/Q/T/Z` morphing is sound.
 *
 * Both strings are decoded once, when a stream is built (`ComplexString`), and the closure
 * `blend` returns is on the per-frame path (ADR-0025): it only lerps and formats.
 */
export const complexInterpolator: InterpolatorEntry<Complex, string> = {
  name: "complex",
  codec: ComplexString,
  blend: (from, to) =>
    Bool.match(sameStructure(from, to), {
      onTrue: () => Option.some(blendNumbers(from, to)),
      onFalse: () => Option.none(),
    }),
}
