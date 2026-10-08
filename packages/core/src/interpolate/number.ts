import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { lerp } from "../math/index.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"

/** Interpolates plain numbers: `Schema.Number` decodes a number as it is. */
export const numberInterpolator: InterpolatorEntry<number, number> = {
  name: "number",
  codec: Schema.Number,
  blend: (from, to) => Option.some((t: number) => lerp(from, to, t)),
}
