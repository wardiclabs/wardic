/**
 * The keys a ward can read, typed from its config (#209 PR 3's Q4): completion offers every key the
 * config animates, through `initial`, `animate`, `exit`, any variant, `whileHover`, `whileTap`,
 * `whileDrag` or `style`, and `x`/`y` when it drags; any other key is still accepted (a custom
 * property, a config built at run time). A config typed as a plain `WardConfig` offers every key.
 *
 * And a config's transitions' entries, checked against the keys each drives (#301's PR 2,
 * {@link WardCheckedConfig}): Solid 2's `ward()` checks its config so.
 *
 * And a Wardic element's keys, inferred from its targets alone (#305, {@link InferredMotion}): the
 * `wardic.*` components of both bindings and Solid 1's `createWard` check their transitions so.
 * Types only.
 *
 * @module
 */
import type * as Machine from "@wardic/core/Machine"
import type { Atom } from "effect/reactivity"
import type {
  WardicInherit,
  WardicOrchestration,
  WardicReducedMotion,
  WardicSkipAnimations,
  WardicTargetValues,
  WardicTransformShorthands,
  WardicTransition,
  WardicTransitionWith,
  WardicValueEntries,
  WardicValueKey,
  WardicValues,
  WardicValueTransition,
  WardicVariantLabels,
  WardicVariantResolver,
} from "./config.ts"
import type { WardicAnimationControls } from "./animation-controls.ts"
import type { Accessor } from "./reactivity.ts"

/** A key's value through its accessor, the Solid 2 binding's per-key form (#259): what it returns. */
type Unwrap<V> = V extends (...args: never) => infer R ? R : V

/**
 * A layer's values map: nothing for a variant name, a list of names (#297), `false`, **Animation
 * controls** (#433) or none; an accessor's, what it returns.
 */
type MapOf<V> = Unwrap<V> extends infer U
  ? U extends object
    ? U extends (...args: never) => unknown
      ? never
      : U extends ReadonlyArray<unknown>
        ? never
        : U extends WardicAnimationControls
          ? never
          : U
    : never
  : never

/** Every variant's values map. */
type VariantMaps<C> = C extends { readonly variants?: infer Ws }
  ? Unwrap<Ws> extends infer Vs
    ? Vs extends object
      ? MapOf<Exclude<Vs, undefined>[keyof Exclude<Vs, undefined>]>
      : never
    : never
  : never

/** Every values map a config animates. */
type MotionLayers<C> =
  | MapOf<C extends { readonly initial?: infer V } ? V : never>
  | MapOf<C extends { readonly animate?: infer V } ? V : never>
  | MapOf<C extends { readonly exit?: infer V } ? V : never>
  | MapOf<C extends { readonly whileHover?: infer V } ? V : never>
  | MapOf<C extends { readonly whileTap?: infer V } ? V : never>
  | MapOf<C extends { readonly whileDrag?: infer V } ? V : never>
  | VariantMaps<C>

/** Every values map a config animates or styles with. */
type Layers<C> = MotionLayers<C> | MapOf<C extends { readonly style?: infer V } ? V : never>

/** The keys of each member of a union. */
// A target's own `transition` (#277) is how it animates, not a key it animates; its `transitionEnd`
// (#428) holds keys, not a value.
type KeysOf<U> = U extends unknown ? Exclude<keyof U & string, "transition" | "transitionEnd"> : never

/** Each member's Transition end's keys (#428): keys a ward reads, though no transition drives them. */
type EndKeysOf<U> = U extends { readonly transitionEnd?: infer E } ? KeysOf<MapOf<E>> : never

/** A config's `drag`, through its accessor. */
type DragOf<C> = C extends { readonly drag: infer D } ? Unwrap<D> : never

/** The keys a drag moves: its axis's, or both. */
// No `drag` is `never`, which every tuple below would take: none first (#297's WK7 found it).
type DragKeys<C> = [DragOf<C>] extends [never]
  ? never
  : [DragOf<C>] extends ["x"]
    ? "x"
    : [DragOf<C>] extends ["y"]
      ? "y"
      : [DragOf<C>] extends [true]
        ? "x" | "y"
        : never

/** The keys a config animates, and the ones its targets' Transition ends set (#428). */
export type AnimatedKey<C> = KeysOf<Layers<C>> | EndKeysOf<MotionLayers<C>> | DragKeys<C>

/**
 * The keys a config's transitions drive (#305's Q2): {@link AnimatedKey}'s but `style`'s. Wardic never
 * follows a `style` change (ADR-0022, decision 5), so a key only `style` sets never runs on one.
 */
export type DrivenKey<C> = KeysOf<MotionLayers<C>> | DragKeys<C>

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

// --- Transition entries, checked (#301's PR 2, ADR-0049) ---------------------------------------

/** A transition option's name, on either arm, a target's `inherit` among them: never an entry. */
type OptionName =
  | keyof (Omit<Machine.SpringOptions, "from"> & Machine.AnimateOptions & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicInherit)
  | "type"

/**
 * What a name that's neither an option nor an entry the transition allows is checked against: why.
 * As an object for a value that isn't one (a mistyped option), which a string would meet as `never`.
 */
type NotHere<P extends string, V> = V extends object
  ? `'${P}' is neither a transition option nor a key animated here`
  : { readonly "is neither a transition option nor a key animated here": P }

/** Whether keys are every value's (a config typed wide, `WardConfig`'s): no literal key is a template. */
type IsWide<K> = `-${string}` extends K ? true : false

/**
 * Each member's keys, as one union. A union's own `keyof` is the keys they share, an intersection:
 * for a transition's two arms, two unions of every value's name, which TS crosses (TS2590).
 */
type KeysIn<T> = T extends unknown ? keyof T & string : never

/** Each member's value at `P`. */
type ValueIn<T, P extends string> = T extends unknown ? (P extends keyof T ? T[P] : never) : never

/** `X` in the form `raw` was given: an accessor of it for an accessor (#259's per-key config), which may read none. */
type Rewrap<Raw, X> = Raw extends (...args: never) => unknown ? () => X | undefined : X

/**
 * The transition given as `raw`, checked (#301): entries for `K` (and `default`), every other name
 * an option, else an error naming it.
 */
type CheckedTransition<Raw, E, K extends string> =
  IsWide<K | KeysIn<NonNullable<Unwrap<Raw>>>> extends true
    ? unknown
    : Rewrap<
        Raw,
        & WardicTransitionWith<E>
        & WardicInherit
        & { readonly [P in Exclude<KeysIn<NonNullable<Unwrap<Raw>>>, K | OptionName | "default">]: NotHere<P, ValueIn<NonNullable<Unwrap<Raw>>, P>> }
      >

/** `C`'s value at `K`, or `undefined` without one. */
type RawOf<C, K extends string> = K extends keyof C ? C[K] : undefined

/**
 * A target, checked: its values as any target's, Keyframes among them (#429), and its own transition (#277) with entries for the
 * keys it sets (Q2) and `default`, no `layout`. A dynamic variant is a resolver as ever, a variant
 * name or `false` as it is.
 */
type CheckedTarget<T> = T extends (...args: never) => unknown
  ? WardicVariantResolver
  : T extends WardicAnimationControls
    ? T
    : T extends object
      ? T extends ReadonlyArray<unknown>
        ? T
        : Omit<WardicTargetValues, "transition"> & { readonly transition?: CheckedTransition<RawOf<T, "transition">, WardicValueEntries<KeysOf<T>>, KeysOf<T>> } & CheckedEnd<T> & NoStray<T>
      : T

/** `initial`, checked (#305's Q4): its values' names. A variant name, a list of them or `false` as it is. */
type CheckedInitial<T> = T extends object ? (T extends ReadonlyArray<unknown> ? T : Omit<WardicTargetValues, "transition"> & CheckedEnd<T> & NoStray<T>) : T

/** What a name in a values map that isn't a value meets: an error naming it, an object, as {@link NotHere}'s. */
type NotAValue<P extends string> = { readonly "is not a value Wardic animates": P }

/**
 * `T`'s names that aren't values, each an error (#305's Q4). The config is inferred from its literal,
 * so every name a values map has is a known property: the check is what rejects `opacty`.
 */
type NoStray<T> = T extends object
  ? IsWide<keyof T & string> extends true
    ? unknown
    : { readonly [P in Exclude<keyof T & string, WardicValueKey | "transition" | "transitionEnd">]: NotAValue<P> }
  : unknown

/** A target's Transition end, checked (#428): a values map whose names are values. */
type CheckedEnd<T> = { readonly transitionEnd?: Omit<WardicValues, "transition"> & NoStray<RawOf<T, "transitionEnd">> }

/** The config props that take a target. */
type TargetProp = "animate" | "exit" | "whileHover" | "whileTap" | "whileDrag" | "whileFocus" | "whileInView"

/** Each variant, checked; a variants map typed wide as it is. */
type VariantsOf<C> = Unwrap<C["variants" & keyof C]> extends infer Vs
  ? Vs extends object
    ? Rewrap<C["variants" & keyof C], { readonly [N in keyof Vs]: CheckedTarget<Vs[N]> }>
    : C["variants" & keyof C]
  : never

/** Whether a prop gives a variant name, or a list of them (#297), or **Animation controls** (#433), which give them. */
type GivesLabels<V> = Unwrap<V> extends string | ReadonlyArray<string> | WardicAnimationControls ? true : false

/**
 * Whether Variant children can join the element (Motion's `isVariantNode`): it has `variants`, or
 * gives a variant name in `initial` or `animate`. They inherit its `transition`, so its entries may
 * be for their keys.
 */
type HandsDown<C> = true extends
  | ("variants" extends keyof C ? ([Unwrap<C["variants" & keyof C]>] extends [undefined] ? false : true) : false)
  | ("initial" extends keyof C ? GivesLabels<C["initial" & keyof C]> : false)
  | ("animate" extends keyof C ? GivesLabels<C["animate" & keyof C]> : false)
  ? true
  : false

/**
 * The element's `transition`, checked (Q1): entries for the keys it animates, `default` and `layout`.
 * An element Variant children can join takes every value's name, as Motion types it: they inherit
 * it.
 */
type ElementTransition<C> = HandsDown<C> extends true
  ? Rewrap<RawOf<C, "transition">, WardicTransition>
  : CheckedTransition<RawOf<C, "transition">, WardicValueEntries<DrivenKey<C>> & { readonly layout?: WardicValueTransition }, DrivenKey<C> | "layout">

/**
 * A config `C` with its transitions' entries checked (#301's PR 2, ADR-0049), for a binding whose
 * config is `W`: completion inside a `transition` offers the keys it drives, and an entry for any
 * other is an error naming it. The element's `transition` takes the keys the element animates,
 * `default` and `layout`, every value's name for an element Variant children can join; a target's
 * own (a variant's, `animate`'s, a gesture's, `exit`'s), the keys that target sets and `default`. A
 * config typed as a plain `WardConfig` takes every name. Every other key is `W`'s, so a callback's
 * parameters are typed as ever.
 */
export type WardCheckedConfig<C, W> = C & {
  readonly [K in keyof W]?: K extends "transition"
    ? ElementTransition<C>
    : K extends keyof C
      ? K extends TargetProp
        ? Rewrap<C[K], CheckedTarget<Unwrap<C[K]>>>
        : K extends "variants"
          ? VariantsOf<C>
          : K extends "initial"
            ? Rewrap<C[K], CheckedInitial<Unwrap<C[K]>>>
            : W[K]
      : W[K]
}

// --- A Wardic element's keys, inferred (#305, ADR-0049) -------------------------------------------

/** A name a target sets: a value's, its own `transition`, or its `transitionEnd` (#428). */
export type TargetKey = WardicValueKey | "transition" | "transitionEnd"

/** The value names among a target's names: not its `transition` or its `transitionEnd`. */
type ValueNameOf<K> = Exclude<K, "transition" | "transitionEnd">

/**
 * The names `K` a values map sets, inferred from it. One that isn't a value fails `K`'s constraint, so
 * `K` is every name and the map is checked against all of them, where it's an excess property.
 */
type NamesOf<K extends string> = { readonly [P in K]?: unknown }

/**
 * A target, its names inferred into `K` (#305's Q1): any target's values, and its own transition with
 * entries for the element's keys `E` and `default`, no `layout` (Q3). A values map's own type stays
 * whole, so an editor completes every value's name inside it while `K` is being inferred.
 */
export type InferredTarget<K extends TargetKey, E extends string> =
  & Omit<WardicTargetValues, "transition">
  & { readonly transition?: (WardicTransitionWith<WardicValueEntries<E>> & WardicInherit) | WardicValues["transition"] }
  & { readonly transitionEnd?: Omit<WardicValues, "transition"> }
  & NamesOf<K>

/** The keys a drag `D` moves. */
type DragMoves<D> = [D] extends [never] ? never : [D] extends ["x"] ? "x" : [D] extends ["y"] ? "y" : [D] extends [true] ? "x" | "y" : never

/**
 * Whether variant names `L` were given. A values map is inferred into `L` too, failing its constraint,
 * so `L` is then every name, `string`-wide: only a literal name counts.
 */
type GivesNames<L> = [L] extends [never] ? false : string extends L ? false : true

/**
 * Whether Variant children can join the element (Motion's `isVariantNode`): it has `variants` (names
 * `N`), or gives a name in `initial` or `animate`. They inherit its `transition`, so it takes every
 * value's name (#301's Q1).
 */
type JoinedBy<N extends string, LI, LA> = [N] extends [never] ? (true extends GivesNames<LI> | GivesNames<LA> ? true : false) : true

/**
 * The keys the element animates: its targets' names, its drag axis's, and `X`, those it animates
 * through a ward given to it (#398). A key only `style` sets never runs on a transition (Q2).
 */
type InferredKey<K extends TargetKey, D, X extends string> = ValueNameOf<K> | DragMoves<D> | X

/** The props {@link InferredMotion} types again. */
type InferredProp = "initial" | "animate" | "exit" | "whileHover" | "whileTap" | "whileDrag" | "whileFocus" | "whileInView" | "variants" | "transition" | "drag"

/**
 * The motion props `M` (a Wardic element's, or a Solid 1 ward's config) with their keys inferred
 * (#305): `K` from every target, `N` from `variants`' names, `LI` and `LA` from a name given in
 * `initial` and `animate`, `D` from `drag`; `X`, the keys a ward given to the element animates. Each target keeps its own type, so a name in it that isn't
 * a value is still an error. The element's `transition` takes entries for the keys it animates,
 * `default` and `layout`, every value's name when Variant children can join it, or when no key could
 * be inferred: an overloaded generic call in a target (Effect's `Bool.match`) gives TS none.
 * `transition` gives `K` no names of its own (`NoInfer`).
 */
export type InferredMotion<M, K extends TargetKey, N extends string, LI extends WardicVariantLabels, LA extends WardicVariantLabels, D extends boolean | "x" | "y", X extends string = never> =
  & Omit<M, InferredProp>
  & {
    readonly initial?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | LI | false
    readonly animate?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | LA | WardicAnimationControls
    readonly exit?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantLabels
    readonly whileHover?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantLabels
    readonly whileTap?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantLabels
    readonly whileDrag?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantLabels
    readonly whileFocus?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantLabels
    readonly whileInView?: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantLabels
    readonly variants?: { readonly [V in N]: InferredTarget<K, NoInfer<ValueNameOf<K>>> | WardicVariantResolver }
    readonly drag?: D
    readonly transition?: NoInfer<
      true extends JoinedBy<N, LI, LA> | ([InferredKey<K, D, X>] extends [never] ? true : false)
        ? WardicTransition
        : WardicTransitionWith<WardicValueEntries<InferredKey<K, D, X>> & { readonly layout?: WardicValueTransition }>
    >
  }
