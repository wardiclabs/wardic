/**
 * An element's own values: what its style or computed style says for a key, read once per element, for its Base values (ADR-0022).
 *
 * `@wardic/dom/OwnValues` (#132, ADR-0041).
 */
export {
  ownValues as of,
  styleValueOf,
  valueLike,
  type OwnValue,
} from "./internal/own-values.ts"
