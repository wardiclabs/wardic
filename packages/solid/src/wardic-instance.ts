/**
 * A **Wardic instance**'s types (#516, ADR-0067 *Amendment (#516)*): what `createWardic(features)`
 * returns, its `w` typed to those Features' props alone.
 *
 * @module
 */
import type { W } from "./w.tsx"

/**
 * What `createWardic(features)` returns for Features `F`: a `w` whose elements bring them, wherever
 * they render, and take their props alone. A prop of a Feature `F` lacks is typed
 * `NeedsFeature<"name">`, so giving it is an error naming the Feature.
 *
 * @example
 * export const { w } = createWardic([domAnimation, layout])
 * <w.li layout whileHover={{ scale: 1.05 }} />   // ok
 * <w.li drag />                                  // error: NeedsFeature<"drag">
 */
export interface WardicInstance<F> {
  readonly w: W<F>
}
