/**
 * Where a key starts, and where it returns: an element's Base value for a key is the first of its base
 * target (its `animate`, else an inherited variant, else its `initial`), its `initial`, its own `style`,
 * the values it started at, and its Own value, which its Environment reads off it. `of` finds it, and
 * `start` finds where a key with no value yet starts. Pure, and shared by every binding and Environment.
 *
 * @example
 * import * as BaseValue from "@wardic/core/BaseValue"
 *
 * BaseValue.of("opacity", { base: {}, initial: { opacity: 0 }, style: () => Option.none(), own: readOwn })
 * // Option.some({ value: 0, source: "initial" }): where opacity returns once nothing sets it
 */
// Base values (ADR-0022). The read of an element's own value is the Environment's (`@wardic/dom`'s
// `ownValues`). Tier 2, for binding and Environment authors, and Effect-native: a missing
// value is an `Option` (ADR-0008 as amended by ADR-0025). Pure and per element, so quiet: no span, no log.
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import type * as Values from "./Values.ts"

/**
 * Each transform key's identity: the value that leaves an element untransformed, 1 for a scale and 0 for
 * a translation, rotation or skew. A transform key's Own value is its identity, as Motion's is. These are
 * the keys an Environment builds one `transform` from.
 */
// Motion's `defaultTransformValue` (motion-dom parse-transform.ts:62-64 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8),
// and what Motion uses at runtime, since every motion element's read takes its projected branch
// (HTMLVisualElement.ts:51). `@wardic/dom`'s renderer derives its set from this one.
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
  // A path's turn (#438, Motion's `pathRotation`): added onto `rotate` where the transform is built.
  pathRotation: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  skewX: 0,
  skewY: 0,
})

/** A transform key's identity (see {@link TRANSFORM_IDENTITY}), or `None` for any other key, prototype names included. */
export const transformIdentity = (key: string): Option.Option<number> => Rec.get(TRANSFORM_IDENTITY, key)

/** Which link of the chain a Base value came from. */
export type BaseSource = "base" | "initial" | "style" | "started" | "own"

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
 * - `base`: the base of the element's Override stack: its own `animate`, else an inherited variant,
 *   else its `initial`.
 * - `initial`: the element's `initial` values, an inherited `initial` among them.
 * - `style`: the element's user style for the key, coerced to the key's shape; a surface
 *   with no style link passes `() => Option.none()`.
 * - `started`: the values an element with `initial={false}` started at, its `animate` at mount, as
 *   Motion's `baseTarget`; such an element passes an empty `initial`. Optional: left out, no value.
 * - `own`: the element's Own value, read by its Environment; asked only when every earlier
 *   link misses.
 */
// ADR-0007 (the base); #50 (an inherited `initial`); #134 (`started`).
export interface BaseSources {
  readonly base: Values.Values
  readonly initial: Values.Values
  readonly style: ValueLookup
  readonly started?: Values.Values | undefined
  readonly own: ValueLookup
}

/** A link's own value for `key`, by own property only; a key set to `undefined` has none. */
const own = (values: Values.Values, key: string): Option.Option<number | string> =>
  Option.flatMap(Rec.get(values, key), Option.fromUndefinedOr)

/**
 * A key's Base value: where it returns once no layer sets it. The first link that has the
 * key wins: `base`, then `initial`, then `style`, then `started`, then `own`. A later link
 * is never asked once one hits. `None` means no link has it, so the key doesn't return (it
 * stays where it is).
 */
export const of = (key: string, sources: BaseSources): Option.Option<BaseValue> =>
  Option.map(own(sources.base, key), (value): BaseValue => ({ value, source: "base" })).pipe(
    Option.orElse(() => Option.map(own(sources.initial, key), (value): BaseValue => ({ value, source: "initial" }))),
    Option.orElse(() => Option.map(sources.style(key), (value): BaseValue => ({ value, source: "style" }))),
    Option.orElse(() =>
      Option.map(
        Option.flatMap(Option.fromUndefinedOr(sources.started), (started) => own(started, key)),
        (value): BaseValue => ({ value, source: "started" }),
      ),
    ),
    Option.orElse(() => Option.map(sources.own(key), (value): BaseValue => ({ value, source: "own" }))),
  )

/**
 * Where a key with no value yet starts: its `style` value, else its Own value. `None` when neither has
 * one: start the key at its target, with no motion, as Motion does.
 */
// `initial` already seeds the element's values (ADR-0003). Motion's `unresolvedKeyframes[0] =
// finalKeyframe` (KeyframesResolver.ts:226-228).
export const start = (key: string, sources: Pick<BaseSources, "style" | "own">): Option.Option<BaseValue> =>
  Option.map(sources.style(key), (value): BaseValue => ({ value, source: "style" })).pipe(
    Option.orElse(() => Option.map(sources.own(key), (value): BaseValue => ({ value, source: "own" }))),
  )
