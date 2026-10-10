/**
 * The `BaseValue` module. Base values (ADR-0022): where a key with no value starts, and where it returns. Pure and
 * framework-free, so every binding and Environment shares them; the read of an element's
 * own value is the Environment's (`@wardic/dom`'s `ownValues` for the DOM).
 *
 * Tier 2, for binding and Environment authors, and Effect-native: a missing value is an
 * `Option` (ADR-0008 as amended by ADR-0025). Observability: pure and per element, so
 * quiet (no span, no log).
 */
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import type * as Values from "./Values.ts"

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

/** A transform key's identity (see {@link TRANSFORM_IDENTITY}), or `None` for any other key, prototype names included. */
export const transformIdentity = (key: string): Option.Option<number> => Rec.get(TRANSFORM_IDENTITY, key)

/** Which link of the chain a Base value came from. */
export type BaseSource = "base" | "initial" | "style" | "own"

/** A Base value and the link it came from. */
export interface BaseValue {
  readonly value: number | string
  readonly source: BaseSource
}

/** A per-key lookup: a value, or `None` for none. */
export type ValueLookup = (key: string) => Option.Option<number | string>

/**
 * The links of a key's chain, in order.
 *
 * - `base`: the resolved base layer of the Override stack (local `animate` > an inherited
 *   variant > `initial`, ADR-0007).
 * - `initial`: the element's resolved `initial` values. An inherited `initial` (#50) joins
 *   here.
 * - `style`: the element's user style for the key, coerced to the key's shape; a surface
 *   with no style link passes `() => Option.none()`.
 * - `own`: the element's Own value, read by its Environment; asked only when every earlier
 *   link misses.
 */
export interface BaseSources {
  readonly base: Values.Values
  readonly initial: Values.Values
  readonly style: ValueLookup
  readonly own: ValueLookup
}

/** A link's own value for `key`, by own property only; a key set to `undefined` has none. */
const own = (values: Values.Values, key: string): Option.Option<number | string> =>
  Option.flatMap(Rec.get(values, key), Option.fromUndefinedOr)

/**
 * A key's Base value: where it returns once no layer sets it. The first link that has the
 * key wins: `base`, then `initial`, then `style`, then `own`. A later link is never asked
 * once one hits. `None` means no link has it, so the key doesn't return (it stays where
 * it is).
 */
export const of = (key: string, sources: BaseSources): Option.Option<BaseValue> =>
  Option.map(own(sources.base, key), (value): BaseValue => ({ value, source: "base" })).pipe(
    Option.orElse(() => Option.map(own(sources.initial, key), (value): BaseValue => ({ value, source: "initial" }))),
    Option.orElse(() => start(key, sources)),
  )

/**
 * Where a key with no value yet starts: its `style` value, then its Own value (`initial`
 * already seeds the element's values, ADR-0003). `None` means neither has it; the
 * caller's last resort is to start the key at its target, with no motion (Motion's
 * `unresolvedKeyframes[0] = finalKeyframe`, KeyframesResolver.ts:226-228).
 */
export const start = (key: string, sources: Pick<BaseSources, "style" | "own">): Option.Option<BaseValue> =>
  Option.map(sources.style(key), (value): BaseValue => ({ value, source: "style" })).pipe(
    Option.orElse(() => Option.map(sources.own(key), (value): BaseValue => ({ value, source: "own" }))),
  )
