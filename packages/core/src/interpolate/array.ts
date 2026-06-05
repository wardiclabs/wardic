import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

/** Interpolates fixed-length numeric arrays element-wise (e.g. RGB tuples). */
export const arrayInterpolator: InterpolatorEntry<ReadonlyArray<number>> = {
  name: "array",
  match: (value) => Array.isArray(value) && value.every((n) => typeof n === "number"),
  interpolate: (from, to, t) => from.map((a, i) => lerp(a, to[i] ?? a, t)),
}
