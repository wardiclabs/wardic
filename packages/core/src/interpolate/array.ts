import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

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
export const arrayInterpolator: InterpolatorEntry<ReadonlyArray<number>, ReadonlyArray<number>> = {
  name: "array",
  codec: Schema.Array(Schema.Number),
  blend: (from, to) => Option.some((t: number) => Arr.map(from, (a, i) => lerp(a, endAt(to, i, a), t))),
}
