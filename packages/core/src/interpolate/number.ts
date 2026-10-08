import * as Predicate from "effect/Predicate"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

/** Interpolates plain numbers. */
export const numberInterpolator: InterpolatorEntry<number> = {
  name: "number",
  match: Predicate.isNumber,
  interpolate: (from, to, t) => lerp(from, to, t),
}
