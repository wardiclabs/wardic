/**
 * An element's own values: what its style or its computed style says for a key, read once, the value an
 * animation starts from, and returns to when nothing else sets it. `valueLike` reads a raw value in the
 * shape of the key's target.
 *
 * @example
 * import * as OwnValues from "@wardic/dom/OwnValues"
 *
 * const own = OwnValues.of(element)
 * own("opacity") // Some("1"), from its computed style
 * OwnValues.valueLike("10px", 0) // Some(10)
 */
// `@wardic/dom/OwnValues` (#132, ADR-0041): its Base values (ADR-0022).
export {
  ownValues as of,
  styleValueOf,
  valueLike,
  type OwnValue,
} from "./internal/own-values.ts"
