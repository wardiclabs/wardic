import type { Values } from "./options.ts"

/**
 * Base values (ADR-0022): where a key with no value starts, and where it returns. Pure and
 * framework-free, so every binding and Environment shares them; the read of an element's
 * own value is the Environment's (`@wardic/dom`'s `ownValues` for the DOM).
 *
 * Tier 2, for binding and Environment authors. Observability: pure and per element, so
 * quiet (no span, no log).
 */

/**
 * The identity of each transform key: the value that leaves an element untransformed, 1 for
 * a scale and 0 for a translation, rotation or skew. A transform key's Own value is its
 * identity: Motion's rule (`defaultTransformValue`, motion-dom parse-transform.ts:62-64 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8), and what Motion uses at runtime, since every
 * motion element's read takes its projected branch (HTMLVisualElement.ts:51).
 *
 * The key set is the transform shorthands an Environment groups into one transform (the
 * DOM renderer derives its set from this one).
 */
export const TRANSFORM_IDENTITY: Readonly<Record<string, number>> = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  translateX: 0,
  translateY: 0,
  translateZ: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  skewX: 0,
  skewY: 0,
})

/** A transform key's identity (see {@link TRANSFORM_IDENTITY}), or `undefined` for any other key. */
export const transformIdentity = (key: string): number | undefined =>
  Object.hasOwn(TRANSFORM_IDENTITY, key) ? TRANSFORM_IDENTITY[key] : undefined

/** Which link of the chain a Base value came from. */
export type BaseSource = "base" | "initial" | "style" | "own"

/** A Base value and the link it came from. */
export interface BaseValue {
  readonly value: number | string
  readonly source: BaseSource
}

/** A per-key lookup: a value, or `undefined` for none. */
export type ValueLookup = (key: string) => number | string | undefined

/**
 * The links of a key's chain, in order.
 *
 * - `base`: the resolved base layer of the Override stack (local `animate` > an inherited
 *   variant > `initial`, ADR-0007).
 * - `initial`: the element's resolved `initial` values. An inherited `initial` (#50) joins
 *   here.
 * - `style`: the element's user style for the key, coerced to the key's shape; a surface
 *   with no style link passes `() => undefined`.
 * - `own`: the element's Own value, read by its Environment; asked only when every earlier
 *   link misses.
 */
export interface BaseSources {
  readonly base: Values
  readonly initial: Values
  readonly style: ValueLookup
  readonly own: ValueLookup
}

const own = (values: Values, key: string): number | string | undefined =>
  Object.hasOwn(values, key) ? values[key] : undefined

/**
 * A key's Base value: where it returns once no layer sets it. The first link that has the
 * key wins: `base`, then `initial`, then `style`, then `own`. A later link is never asked
 * once one hits. `undefined` means no link has it, so the key doesn't return (it stays where
 * it is).
 */
export const baseValueOf = (key: string, sources: BaseSources): BaseValue | undefined => {
  const base = own(sources.base, key)
  if (base !== undefined) return { value: base, source: "base" }
  const initial = own(sources.initial, key)
  if (initial !== undefined) return { value: initial, source: "initial" }
  return startValueOf(key, sources)
}

/**
 * Where a key with no value yet starts: its `style` value, then its Own value (`initial`
 * already seeds the element's values, ADR-0003). `undefined` means neither has it; the
 * caller's last resort is to start the key at its target, with no motion (Motion's
 * `unresolvedKeyframes[0] = finalKeyframe`, KeyframesResolver.ts:226-228).
 */
export const startValueOf = (key: string, sources: Pick<BaseSources, "style" | "own">): BaseValue | undefined => {
  const style = sources.style(key)
  if (style !== undefined) return { value: style, source: "style" }
  const read = sources.own(key)
  if (read !== undefined) return { value: read, source: "own" }
  return undefined
}
