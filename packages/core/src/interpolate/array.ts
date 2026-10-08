import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

/** An array. */
const isArray: Predicate.Refinement<unknown, ReadonlyArray<unknown>> = Arr.isArray

/** An array of numbers. */
const isNumberArray: Predicate.Predicate<unknown> = Predicate.compose(isArray, Arr.every(Predicate.isNumber))

/**
 * `to`'s number at `index`, or `fallback` past its end. On the per-frame path (ADR-0025): an
 * early return, no `Option`.
 */
const endAt = (to: ReadonlyArray<number>, index: number, fallback: number): number => {
  const end = to[index]
  if (Predicate.isNullish(end)) return fallback
  return end
}

/** Interpolates fixed-length numeric arrays element-wise (e.g. RGB tuples). */
export const arrayInterpolator: InterpolatorEntry<ReadonlyArray<number>> = {
  name: "array",
  match: isNumberArray,
  interpolate: (from, to, t) => Arr.map(from, (a, i) => lerp(a, endAt(to, i, a), t)),
}
