/**
 * The keys a ward can read, typed from its config (#209 PR 3's Q4): completion offers every key the
 * config animates, through `initial`, `animate`, `exit`, any variant, `whileHover`, `whileTap`,
 * `whileDrag` or `style`, and `x`/`y` when it drags; any other key is still accepted (a custom
 * property, a config built at run time). A config typed as a plain `WardConfig` offers every key.
 * Types only.
 *
 * @module
 */
import type { Atom } from "effect/reactivity"
import type { WardicTransformShorthands } from "./config.ts"
import type { Accessor } from "./reactivity.ts"

/** A key's value through its accessor, the Solid 2 binding's per-key form (#259): what it returns. */
type Unwrap<V> = V extends (...args: never) => infer R ? R : V

/** A layer's values map: nothing for a variant name, `false` or none; an accessor's, what it returns. */
type MapOf<V> = Unwrap<V> extends infer U ? (U extends object ? (U extends (...args: never) => unknown ? never : U) : never) : never

/** Every variant's values map. */
type VariantMaps<C> = C extends { readonly variants?: infer Ws }
  ? Unwrap<Ws> extends infer Vs
    ? Vs extends object
      ? MapOf<Exclude<Vs, undefined>[keyof Exclude<Vs, undefined>]>
      : never
    : never
  : never

/** Every values map a config animates or styles with. */
type Layers<C> =
  | MapOf<C extends { readonly initial?: infer V } ? V : never>
  | MapOf<C extends { readonly animate?: infer V } ? V : never>
  | MapOf<C extends { readonly exit?: infer V } ? V : never>
  | MapOf<C extends { readonly whileHover?: infer V } ? V : never>
  | MapOf<C extends { readonly whileTap?: infer V } ? V : never>
  | MapOf<C extends { readonly whileDrag?: infer V } ? V : never>
  | MapOf<C extends { readonly style?: infer V } ? V : never>
  | VariantMaps<C>

/** The keys of each member of a union. */
type KeysOf<U> = U extends unknown ? keyof U & string : never

/** A config's `drag`, through its accessor. */
type DragOf<C> = C extends { readonly drag: infer D } ? Unwrap<D> : never

/** The keys a drag moves: its axis's, or both. */
type DragKeys<C> = [DragOf<C>] extends ["x"] ? "x" : [DragOf<C>] extends ["y"] ? "y" : [DragOf<C>] extends [true] ? "x" | "y" : never

/** The keys a config animates. */
export type AnimatedKey<C> = KeysOf<Layers<C>> | DragKeys<C>

/** A key a ward can read: one its config animates (completed), or any other (accepted). */
export type WardKey<C> = AnimatedKey<C> | (string & {})

/** A value as a ward reads it: a number or a string, a Live value read through. */
type Widen<V> = V extends number ? number : V extends string ? string : V extends Accessor<infer A> ? Widen<A> : V extends Atom.Atom<infer A> ? Widen<A> : never

/** `K`'s values across a config's layers. */
type ValuesAt<C, K extends string> = Layers<C> extends infer L ? (L extends unknown ? (K extends keyof L ? L[K] : never) : never) : never

/**
 * What a ward reads for `K`: a transform key is always a number (its identity at rest); any other
 * key, the type its config gives it (a number or a string), or `undefined` with no value.
 */
export type WardValueOf<C, K extends string> = K extends keyof WardicTransformShorthands
  ? number
  : [Widen<ValuesAt<C, K>>] extends [never]
    ? number | string | undefined
    : Widen<ValuesAt<C, K>> | undefined
