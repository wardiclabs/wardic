/**
 * **Measured pairs** (#430, CONTEXT.md, Motion's `DOMKeyframesResolver`): a positional key whose two
 * ends differ in type (`"auto"`, `"50%"` against px, a `calc()`), measured in px at both ends at the
 * end of the task that asks, so its leg runs between them and lands on its target as given.
 *
 * `@wardic/dom/MeasuredPair`: for binding authors.
 */
export { isMeasuredPair, measure, type MeasuredPair } from "./internal/measured-pairs.ts"
