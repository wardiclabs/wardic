import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { InterpolatorRegistry } from "../services/InterpolatorRegistry.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { arrayInterpolator } from "./array.ts"
import { colorInterpolator } from "./color.ts"
import { complexInterpolator } from "./complex.ts"
import { numberInterpolator } from "./number.ts"
import { unitInterpolator } from "./unit.ts"

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry is heterogeneous by design */

/**
 * The interpolators core ships with, in resolution order. `number` and `array`
 * are checked first (cheap, unambiguous); `color` before `unit` so `"#fff"`
 * routes to color while `"10px"` routes to unit; `complex` LAST so it only
 * catches multi-number structural strings (SVG `d`/`points`, `filter`,
 * `box-shadow`) the specific entries didn't claim (ADR-0015).
 */
export const defaultInterpolators: ReadonlyArray<InterpolatorEntry<any>> = [
  numberInterpolator,
  arrayInterpolator,
  colorInterpolator("rgb"),
  unitInterpolator,
  complexInterpolator,
]

const UNIT_PAIR_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i

interface ParsedUnit {
  readonly value: number
  readonly unit: string
}

const parseUnit = (input: string): ParsedUnit | undefined => {
  const match = UNIT_PAIR_RE.exec(input.trim())
  if (match === null) return undefined
  return { value: Number.parseFloat(match[1]!), unit: match[2] ?? "" }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Pair-aware entry selection.
 *
 * An entry "matches a pair" iff it matches at least one endpoint. When
 * multiple entries match, the most type-bearing one wins — concretely, the
 * entry that matches a string endpoint beats one that only matches a numeric
 * endpoint (so `(0, "10px")` resolves to the unit interpolator, not number).
 *
 * Returns `undefined` when no entry matches either endpoint, signalling the
 * discrete-fallback path: a Discrete pair, which switches to `to` at the first
 * frame past 0 (`t > 0 ? to : from`, ADR-0024 decision 3; Motion's `mixImmediate`).
 */
const selectEntry = (
  entries: ReadonlyArray<InterpolatorEntry<any>>,
  from: unknown,
  to: unknown,
): InterpolatorEntry<any> | undefined => {
  // Pass 1: entry that matches both endpoints — strongest signal.
  const both = entries.find((e) => e.match(from) && e.match(to))
  if (both !== undefined) return both

  // Pass 2: entry that matches the non-number/non-array endpoint — that side
  // carries the type information, so it wins over a number/array matcher on
  // the other endpoint.
  const isPlain = (value: unknown): boolean =>
    typeof value === "number" || Array.isArray(value)
  if (!isPlain(from) && isPlain(to)) {
    const entry = entries.find((e) => e.match(from))
    if (entry !== undefined) return entry
  }
  if (!isPlain(to) && isPlain(from)) {
    const entry = entries.find((e) => e.match(to))
    if (entry !== undefined) return entry
  }

  // Pass 3: any entry that matches either endpoint, in registry precedence.
  return entries.find((e) => e.match(from) || e.match(to))
}

/**
 * Resolves a pair to a pure `(t) => From | To` for the given entry. Handles
 * the mixed numeric `from` + unit-string `to` (and the symmetric) case by
 * coercing the bare number to the same unit as the string. Incompatible
 * unit pairs (e.g. `"10px"` + `"1em"`) produce an `Effect.die` with both
 * units in the message.
 */
const bind = <From, To>(
  entry: InterpolatorEntry<any>,
  from: From,
  to: To,
): Effect.Effect<(t: number) => From | To> => {
  type R = From | To
  // Unit interpolator: enforce compatible units and coerce bare numbers.
  if (entry.name === "unit") {
    const fromIsNumber = typeof from === "number"
    const toIsNumber = typeof to === "number"

    if (typeof from === "string" && typeof to === "string") {
      const a = parseUnit(from)
      const b = parseUnit(to)
      if (a === undefined || b === undefined) {
        // Non-parseable string (e.g. "auto"): fall through to discrete.
        return Effect.succeed((t: number) => (t > 0 ? to : from) as R)
      }
      if (a.unit !== "" && b.unit !== "" && a.unit !== b.unit) {
        return Effect.die(
          new Error(
            `wardic.interpolator: incompatible units "${a.unit}" and "${b.unit}" (from "${from}", to "${to}")`,
          ),
        )
      }
      const unit = a.unit || b.unit
      return Effect.succeed((t: number) => `${lerp(a.value, b.value, t)}${unit}` as R)
    }

    if (fromIsNumber && typeof to === "string") {
      const b = parseUnit(to)
      if (b === undefined) {
        return Effect.succeed((t: number) => (t > 0 ? to : from) as R)
      }
      const aValue = from as number
      return Effect.succeed((t: number) => `${lerp(aValue, b.value, t)}${b.unit}` as R)
    }

    if (toIsNumber && typeof from === "string") {
      const a = parseUnit(from)
      if (a === undefined) {
        return Effect.succeed((t: number) => (t > 0 ? to : from) as R)
      }
      const bValue = to as number
      return Effect.succeed((t: number) => `${lerp(a.value, bValue, t)}${a.unit}` as R)
    }
  }

  // Default: if the entry doesn't match both endpoints, fall back to discrete
  // (the entry's `interpolate` is only contracted for matching inputs).
  if (!entry.match(from) || !entry.match(to)) {
    return Effect.succeed((t: number) => (t > 0 ? to : from) as R)
  }

  return Effect.succeed((t: number) => entry.interpolate(from, to, t) as R)
}

/**
 * Builds the `InterpolatorRegistry` service shape over a mutable entry list.
 * `register` prepends, so later registrations take precedence over built-ins.
 *
 * `resolve` is the hot-path entry: it picks an entry once for a pair and
 * returns a pure `(t) => T`. `interpolate` is sugar — same selection logic,
 * one-shot application. Both share `selectEntry` + `bind`, so semantics stay
 * lock-step.
 */
export const makeInterpolatorRegistry = (
  initial: ReadonlyArray<InterpolatorEntry<any>> = defaultInterpolators,
) =>
  Effect.sync(() => {
    const entries: Array<InterpolatorEntry<any>> = [...initial]

    const resolve = <From, To>(
      from: From,
      to: To,
    ): Effect.Effect<(t: number) => From | To> => {
      const entry = selectEntry(entries, from, to)
      if (entry === undefined) {
        return Effect.succeed((t: number) => (t > 0 ? to : from))
      }
      return bind(entry, from, to)
    }

    return {
      register: <T>(entry: InterpolatorEntry<T>) =>
        Effect.gen(function* () {
          entries.unshift(entry as InterpolatorEntry<any>)
          yield* Effect.logDebug("wardic.interpolator: register").pipe(
            Effect.annotateLogs({ interpolator: entry.name }),
          )
        }),
      resolve,
      interpolate: <From, To>(from: From, to: To, t: number): Effect.Effect<From | To> =>
        Effect.map(resolve(from, to), (fn) => fn(t)),
    }
  })

/** `InterpolatorRegistry` Layer pre-loaded with core's built-in interpolators. */
export const InterpolatorRegistryLive: Layer.Layer<InterpolatorRegistry> = Layer.effect(
  InterpolatorRegistry,
)(makeInterpolatorRegistry())
