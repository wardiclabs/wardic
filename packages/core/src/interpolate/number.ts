import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

/** Interpolates plain numbers. */
export const numberInterpolator: InterpolatorEntry<number> = {
  name: "number",
  match: (value) => typeof value === "number",
  interpolate: (from, to, t) => lerp(from, to, t),
}
