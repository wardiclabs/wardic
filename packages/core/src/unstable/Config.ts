/**
 * The config types a binding's elements and the spine share, each built on {@link ValueKeys}: the keys
 * an Environment animates and the values each takes. Empty here, `ValueKeys` is filled by the
 * Environment's binding types (`@wardic/dom/unstable/WardConfig` fills it), so each type keeps its
 * name and its shape whatever fills it.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (the build grill's Q24 A, Q25): solid's `config.ts`'s types
// that the spine and its neighbours read, moved so core names no Environment's keys (#609). With
// `@wardic/dom` in a program, each is exactly what it was; core's own build sees an empty map, and its
// code reads keys by name at run time, as it did. Only one Environment's types may fill it: a scene's
// keys come through `@wardic/three`'s own `animate` types (ADR-0069, decision 4). The controls'
// interface and its mark (#433) came from `animation-controls.ts` by way of `config.ts`.
import type * as Arc from "../Arc.ts"
import type * as Machine from "../Machine.ts"
import type * as Stagger from "../Stagger.ts"

/**
 * The keys an Environment animates, each with the values it takes: empty in core. An Environment's
 * binding types fill it by declaration merging.
 *
 * @example
 * declare module "@wardic/core/unstable/Config" {
 *   interface ValueKeys extends MyValues {}
 * }
 */
export interface ValueKeys {}

/**
 * A **Keyframes** value (Motion's): the stops a key passes through in order, as
 * `animate={{ scale: [1, 1.2, 1] }}`. A first `null` is where the key is now; a later one repeats the
 * stop before it. An explicit first stop is jumped to as its animation starts. More than two stops run
 * on a tween (Motion's 0.8 s one with no transition defined; `times` places them, `ease` may be one per
 * Interval, between two stops): a spring takes two.
 */
export type WardicKeyframes<V> = ReadonlyArray<V | null>

/**
 * A target's values: each of {@link ValueKeys}' keys with a value or its {@link WardicKeyframes}. Every
 * target takes them; a start reads one at its first stop, and a Transition end takes one value per key.
 */
export type WardicTargetValues = {
  readonly [K in keyof ValueKeys]?: K extends "transition" ? ValueKeys[K] : ValueKeys[K] | WardicKeyframes<Exclude<ValueKeys[K], undefined>>
}

/** A stagger: a child's delay in seconds, from its index and the count. `stagger()` makes one. Motion's `DynamicOption<number>`. */
// #436.
export type WardicStagger = (index: number, total: number) => number

/**
 * A path for `x` and `y` to travel along together: from where they start to where they end, the point
 * at each progress, 0 to 1, with a turn (`rotate`, in degrees) for one that turns the element. `arc()`
 * makes one; any function of this shape is one, a curve of your own.
 */
// A Path (#438).
export type WardicPath = Arc.Path

/**
 * How a parent's variant children are timed against it and each other: `when`, `delayChildren`,
 * `staggerChildren`, `staggerDirection` and `from`. Read on the parent's transition, for the variant
 * change it hands its children.
 */
// ADR-0007: they take effect on the parent that hands its names down; a child inherits them as its
// default transition but reads orchestration off the parent's context, not its own transition.
export interface WardicOrchestration {
  /** Seconds between one child's start and the next's. */
  readonly staggerChildren?: number
  /**
   * Fixed delay added to every child before its staggered offset; or, as Motion's, a function of a
   * child's index and the count, `stagger()`'s, which decides each child's whole delay:
   * `staggerChildren`, `staggerDirection` and `from` aren't read beside it.
   */
  // #436.
  readonly delayChildren?: number | WardicStagger
  /** `-1` reverses the stagger order, the last child first. Default `1`. */
  readonly staggerDirection?: 1 | -1
  /** The child the stagger grows from: `"first"` (the default), `"last"`, `"center"` or an index. */
  readonly from?: Stagger.Origin
  /**
   * Orders the parent and its children: `"beforeChildren"` animates the parent, then the children once
   * it lands; `"afterChildren"` the children, then the parent once they've all landed. Left out, they
   * animate together.
   */
  readonly when?: "beforeChildren" | "afterChildren"
}

/**
 * A transition's reduced-motion opt-out, on both arms. An animation honours the
 * provider's `reducedMotion` by default: under it, its positional keys snap and a layout
 * animation lands at once.
 */
export interface WardicReducedMotion {
  /** `false` animates the transition's keys whatever the provider's `reducedMotion` says. Default `true`. */
  readonly respectReducedMotion?: boolean
}

/**
 * A transition of `type: "inertia"`: each number glides from where it is at its velocity, its own or
 * `velocity`, and comes to rest `power × velocity` on, through `modifyTarget`, springing back to `min`
 * or `max` past one. Its target isn't read, so with no velocity it stays where it is. A value that
 * isn't a number, a colour or a length with units, runs on its default transition instead.
 * `timeConstant` is in milliseconds, as Motion's. Motion's `inertia`.
 */
// #435.
export interface WardicInertia {
  readonly type: "inertia"
  /** The velocity every key glides from, per second: each key's own when left out. */
  readonly velocity?: number
  /** How far a glide carries, as a multiple of its velocity. Default 0.8. */
  readonly power?: number
  /** The glide's time constant, in milliseconds. Default 325. */
  readonly timeConstant?: number
  /** The bounce back from an edge: its stiffness and damping. Defaults 500 and 10. */
  readonly bounceStiffness?: number
  readonly bounceDamping?: number
  /** At rest within this of where it's going. Default 0.5. */
  readonly restDelta?: number
  /** A bounce at rest below this speed, per second. Default 2. */
  readonly restSpeed?: number
  /** Moves where a glide rests, called with where it would: snapping it to a grid, say. */
  readonly modifyTarget?: (ideal: number) => number
  /** The edges: past one, the glide springs back to it. */
  readonly min?: number
  readonly max?: number
  /** Seconds each key holds where it is before it glides. */
  readonly delay?: number
}

/**
 * A transition's **Skipped animation** (Motion's `skipAnimations`), on both arms: `true` lands its
 * keys at their ends on the next frame, with no delay, as a `WardicConfig`'s `skipAnimations` does.
 * `false` doesn't undo a config's.
 */
export interface WardicSkipAnimations {
  readonly skipAnimations?: boolean
}

/**
 * A transition's **Path** (#438, Motion's `path`): `x` and `y` travel along it together, rather than
 * each on its own, on `x`'s transition, from rest. `arc()` makes one; any {@link WardicPath} is one.
 * An axis the target leaves out ends where it rests (#574): where a Path in flight was taking it, so
 * one caught mid-air curves back to its line, else where it is.
 * A layout animation reads it where Motion's does, on its layout transition: the `layout` entry when
 * there is one, else the element's transition. On any other value's entry it isn't read.
 */
export interface WardicTransitionPath {
  readonly path?: WardicPath
}

/**
 * How an element gets to its target: a spring, a tween, or an inertia, with a value's own transition
 * under its name. With no `type`, a spring field (`stiffness`, `damping`, `mass`, `velocity`,
 * `restDelta`, `restSpeed`, `bounce`, `visualDuration`) makes it a spring, and anything else a tween, so
 * `{ duration: 0.5 }` is a 0.5 s tween. A spring's missing fields are Motion's 100 / 10 / 1, or set by
 * time, a `duration` or `visualDuration` with a `bounce`; a tween's easing is `easeOut`. With neither,
 * each value runs on its default. It also takes `delay`, a tween's repeats, a `path`, its variant
 * children's orchestration, `respectReducedMotion` and `skipAnimations`.
 */
// ADR-0051: a transition with only orchestration, `delay` or the opt-out leaves each key on its
// Environment's Default transition. A spring set by time (#359) is solved to its physics. A "tween"
// routes every key through `animateValues`, Keyframes through `keyframesValues` with `times` and an
// `ease` per Interval (#429). `from` is the stagger's origin on both arms: a spring's own `from` was
// never a transition's, and the two clashed (#243). A value's own transition: #301.
export type WardicTransition = WardicTransitionWith<WardicTransitionEntries>

/**
 * A transition with the entries `E` (#301): {@link WardicTransition}'s two arms. A Wardic element's
 * config checks each transition in it against the entries its keys allow (`WardChecked`).
 */
export type WardicTransitionWith<E> =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & E)
  | ({ readonly type?: "tween" } & Machine.KeyframesOptions & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & E)
  | (WardicInertia & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & E)

/**
 * One value's own transition, under its name in a `transition`: a spring, a tween or an inertia, without
 * the orchestration, which is the whole transition's. With `inherit: true` it's laid over the
 * transition's own fields, its own winning; without, it stands alone, taking only the transition's
 * `respectReducedMotion` and `skipAnimations`. Motion's `ValueTransition`.
 */
// #301.
export type WardicValueTransition =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)
  | ({ readonly type?: "tween" } & Machine.KeyframesOptions & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)
  | (WardicInertia & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)

/** `inherit: true` lays a transition over the one it would replace, its own fields winning, as Motion's. */
// #277, #301.
export interface WardicInherit {
  readonly inherit?: boolean
}

/** The name of a value a transition can have an entry for: any of {@link ValueKeys}' keys. */
export type WardicValueKey = Exclude<keyof ValueKeys & string, "transition">

/**
 * A transition's per-value entries: a value's own transition under its name, `default` for every value
 * without one, and `layout` for the element's layout animations. A value runs on its entry, else
 * `default`, else the transition's own fields. Motion's `TransitionWithValueOverrides`.
 */
// #301; `layout`, ADR-0009 *Amendment (#171)*: a layout animation on `layout`, else `default`, else the
// own fields, else Motion's 0.45 s tween.
export type WardicTransitionEntries = WardicValueEntries<WardicValueKey> & { readonly layout?: WardicValueTransition }

/** Entries for the values `K`, and `default` for the rest (#301). */
export type WardicValueEntries<K extends string> = { readonly default?: WardicValueTransition } & { readonly [P in K]?: WardicValueTransition }

/**
 * A variant's own transition, or a target's: it runs the animation that variant starts, in place of
 * the element's `transition`, unless `inherit: true` lays it over the element's, its own fields winning.
 * Motion's.
 */
// #277, ADR-0048.
export type WardicVariantTransition = WardicTransition & WardicInherit

/**
 * A target's **Transition end** (Motion's `transitionEnd`): values set at once, with no
 * animation, once the keys the target animates have landed. Its keys are the target's, so they return to their base when it's no longer active;
 * a target interrupted before it lands never sets them; the target an element renders first sets its
 * own at once, on a server too.
 */
export type WardicTransitionEnd = Omit<ValueKeys, "transition">

/**
 * A target, as a variant, `animate` or `exit` gives it (Motion's `TargetAndTransition`): its
 * values, each a value or its Keyframes ({@link WardicTargetValues}), optionally the transition
 * the animation to it runs on, as an object, and its Transition end ({@link WardicTransitionEnd}).
 * A plain map of {@link ValueKeys}' values fits too, its own `transition` key a value as any other.
 */
export type WardicVariant =
  | (WardicTargetValues & { readonly transitionEnd?: WardicTransitionEnd })
  | (Omit<WardicTargetValues, "transition"> & { readonly transition?: WardicVariantTransition; readonly transitionEnd?: WardicTransitionEnd })

/**
 * Variant names (Motion's `VariantLabels`): one name, or a list of them. A list merges its
 * names' values in order, a later name's winning a key both set. Each key animates on the own
 * transition of the last name that sets it, and each name orchestrates the keys it sets in the
 * element's Variant children. An empty list is no name.
 */
export type WardicVariantLabels = string | ReadonlyArray<string>

/**
 * A dynamic variant (Motion's `TargetResolver`): called each time the variant is
 * resolved with the element's `custom` (or, for an exit, its `<AnimatePresence custom>`), its values
 * now and their velocities, and returns its target, or another variant's name.
 */
export type WardicVariantResolver = (
  // Motion's `custom` is `any`: a resolver declares its own (`(direction: number) => …`).
  custom: any,
  current: Readonly<Record<string, number | string>>,
  velocity: Readonly<Record<string, number>>,
) => WardicVariant | string

/** Named targets, each a target or a {@link WardicVariantResolver}. */
export type WardicVariants = Readonly<Record<string, WardicVariant | WardicVariantResolver>>

/** What controls start or set an element to: a target, a variant name or a list of them, or a function of each element's `custom`. Motion's `AnimationDefinition`. */
export type WardicControlsDefinition = WardicVariant | WardicVariantLabels | WardicVariantResolver

/** The mark that tells controls from a target. */
export const CONTROLS: unique symbol = Symbol("wardic.animationControls")

/**
 * `createAnimationControls()`'s controls: give them as `animate={controls}`, and every element given
 * them follows `start`, `set` and `stop`. Motion's `LegacyAnimationControls`.
 */
// #433.
export interface WardicAnimationControls {
  readonly [CONTROLS]: true
  /**
   * Animates every element given these controls to `definition`, as a change of its `animate` would,
   * its variant children following. `transitionOverride`, when given, is the transition of this change,
   * over the definition's own, and its stagger. Resolves once each element and its children have landed.
   */
  readonly start: (definition: WardicControlsDefinition, transitionOverride?: WardicTransition) => Promise<void>
  /** Sets every element given these controls, and its variant children, at `definition` at once. */
  readonly set: (definition: WardicControlsDefinition) => void
  /** Ends every element's running animation where it is. */
  readonly stop: () => void
}

/**
 * Motion's `definition` of an animation: a variant name, or its target values. A list of names
 * on Solid 2's landing, where `animate` gave one; Solid 1's callbacks are told each name.
 */
export type WardicAnimationDefinition = WardicVariantLabels | ValueKeys

/**
 * A point mapping (Motion's `TransformPoint`): handed a point in the Environment's coordinates, it
 * gives the one a drag or a pan uses.
 */
export type WardicTransformPoint = (point: { readonly x: number; readonly y: number }) => { readonly x: number; readonly y: number }
