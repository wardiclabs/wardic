/**
 * The DOM's Positional keys, the keys reduced motion lands at once rather than animating: the
 * transforms, and the keys that place and size an element's box, `top`, `width` and the rest. `layer`
 * is what `DomLive` provides.
 *
 * @example
 * import * as DomPositionalKeys from "@wardic/dom/DomPositionalKeys"
 *
 * DomPositionalKeys.isPositional("width") // true: it lands at once
 * DomPositionalKeys.isPositional("opacity") // false: it still fades
 */
// `@wardic/dom/DomPositionalKeys` (#132, ADR-0041): ADR-0029, ADR-0036.
export {
  PositionalKeysDomLive as layer,
  isPositional,
} from "./internal/positional-keys.ts"
