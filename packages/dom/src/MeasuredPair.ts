/**
 * Measured pairs: a key that places or sizes the box, whose two ends are lengths of different types,
 * `"auto"` against px, `"50%"` against a number, a `calc()`, can't blend as written. Both ends are
 * measured in px at the end of the task that asks, as Motion's are, so the animation runs between them
 * and lands on its target as given.
 *
 * @example
 * import * as MeasuredPair from "@wardic/dom/MeasuredPair"
 *
 * MeasuredPair.needs("width", "auto", 200) // true
 * MeasuredPair.needs("opacity", 0, 1) // false
 */
// **Measured pairs** (#430, CONTEXT.md, Motion's `DOMKeyframesResolver`). `@wardic/dom/MeasuredPair`: for
// binding authors.
export { measure, measured, type Measured, needs, type Requested } from "./internal/measured-pairs.ts"
