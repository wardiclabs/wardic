/**
 * The rules of an element's place in variant orchestration (ADR-0007, #50), Solid-free (#209): the
 * names an element hands its children and inherits from its parent, the values it starts from, and
 * what a server render builds. Each binding's variant node (`variant-node.ts` for Solid 1,
 * `unstable/v2/variant-node.ts` for Solid 2) runs the orchestration over them, with its own Solid.
 *
 * Motion's rule (CONTEXT.md, **Variant child**):
 * - An element that names its own `initial` or `animate` hands its children those names, and an
 *   `initial={false}` with them (#134). Any other passes its parent's through, unless it sets
 *   `inherit={false}`, which passes none.
 * - A **Variant child** (`variants`, no names of its own, `inherit` not `false`) inherits its
 *   ancestor's names and default transition, takes a stagger slot among the ancestor's variant
 *   children, and counts for the ancestor's `when`.
 * - An element with variants of its own (`variants`, or a name) is what its Variant children
 *   join: it owns their registry, their stagger and their `when`. Any other element passes its
 *   parent's context through, so a Variant child joins its nearest such ancestor; it renders no
 *   Provider unless it sets `inherit={false}` ({@link changesContext}).
 *
 * @module
 */
import type * as Stagger from "@wardic/core/Stagger"
import type * as Values from "@wardic/core/Values"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { AppearGroup } from "./appear.ts"
import type { WardicTransition, WardicVariantLabels } from "./config.ts"
import type { Accessor, Reactivity } from "./reactivity.ts"
import { isLabels, labelsOf, sameLabels, startingVariantsOf } from "./variant-target.ts"

/**
 * The handle a child receives from {@link WardicVariantContextValue.register}
 * when it mounts under a `ward.Provider` (ADR-0007, step 21b).
 *
 * - `index` / `total` — the child's SNAPSHOT position + sibling count for the
 *   CURRENT transition. The Provider rewrites these only at the trigger (the
 *   parent variant changing), never mid-transition; the child reads them to feed
 *   core `stagger(amount, { from })(index, total)`.
 * - `setSettled` — the child reports its own settle state (true when its spine
 *   settles, false while animating), feeding the parent's `allChildrenSettled`.
 * - `dispose` — removes this record from the registry on unmount.
 */
export interface WardicChildRegistration {
  readonly index: Accessor<number>
  readonly total: Accessor<number>
  readonly setSettled: (settled: boolean) => void
  readonly dispose: () => void
}

/** The resolved stagger config the Provider exposes to its children. */
export interface WardicStaggerConfig {
  /** Seconds between siblings (core `stagger` amount). */
  readonly amount: number
  /** Fixed offset added to every child's computed delay. */
  readonly delayChildren: number
  /** Origin the stagger distance grows outward from (core option). */
  readonly from: Stagger.Origin
  /** `1` forward (index = position), `-1` reverses the effective index. */
  readonly direction: 1 | -1
}

/**
 * The value carried down the tree by {@link WardicVariantContext}.
 *
 * - `variant` — the parent instance's CURRENT variant NAME (reactive). It is
 *   `undefined` when the parent's resolved `animate` is a `Values` map rather
 *   than a name (propagation is by name only — a values map has no name to
 *   inherit).
 * - `initial` — the parent's `initial` NAME, or `false`, read once (#50, #134).
 *
 * Every Wardic element provides one (#50): its own if it has variants of its own, else its
 * parent's, passed through (`variant-node.ts`).
 * - `transition` — the parent's transition, inherited as the DEFAULT for
 *   children that supply no local `transition`.
 *
 * Designed to extend without breaking: 21b adds optional `registry` / `stagger`
 * / `when` members; readers consume only the fields they know.
 */
/** A gesture layer, in Motion's priority, lowest first (#291): `whileInView` … `whileDrag`. */
export type GestureLayer = "inView" | "focused" | "hovered" | "pressed" | "dragged"

/** The gesture layers in Motion's priority, lowest first. */
export const GESTURE_LAYERS: ReadonlyArray<GestureLayer> = ["inView", "focused", "hovered", "pressed", "dragged"]

/** The variant names an element hands its Variant children for its active gestures (#291): a name or a list each (#297). */
export type GestureNames = Readonly<Partial<Record<GestureLayer, WardicVariantLabels | undefined>>>

/** No gesture on: what an element with none active hands down. */
export const NO_GESTURE_NAMES: GestureNames = {}

/** Two {@link GestureNames} the same: the same names for each gesture, a list name by name (#297). */
export const sameGestureNames = (a: GestureNames, b: GestureNames): boolean =>
  GESTURE_LAYERS.every((layer) => sameLabels(a[layer], b[layer]))

/** Whether each gesture is on (#291): a spine's, bound to its variant node. */
export type GestureStates = Readonly<Record<GestureLayer, boolean>>

/** No gesture on. */
export const NO_GESTURE_STATES: GestureStates = { inView: false, focused: false, hovered: false, pressed: false, dragged: false }

/**
 * What an element hands its Variant children for its gestures (#291, Motion's `setActive` and variant
 * context): whether each is on (its own, or its own provider's), and each one's label (its own
 * `while*`, if a name, else the one it took). A Variant child's gesture is on while its provider's is.
 */
export interface GestureHandDown {
  readonly on: GestureStates
  readonly names: GestureNames
}

/** Nothing on, no labels: what an element hands down with no provider and no gesture. */
export const NO_HAND_DOWN: GestureHandDown = { on: NO_GESTURE_STATES, names: NO_GESTURE_NAMES }

/** Two hand-downs the same: each gesture on alike, with the same label. */
export const sameHandDown = (a: GestureHandDown, b: GestureHandDown): boolean =>
  GESTURE_LAYERS.every((layer) => Bool.and(a.on[layer] === b.on[layer], sameLabels(a.names[layer], b.names[layer])))

/** What a context hands down, nothing without a context or its gestures. */
export const handDownFrom = (context: WardicVariantContextValue | undefined): GestureHandDown => {
  // Per Retarget, per element: guards, nothing made (most elements have no provider).
  if (Predicate.isUndefined(context)) return NO_HAND_DOWN
  const gestures = context.gestures
  if (Predicate.isUndefined(gestures)) return NO_HAND_DOWN
  return gestures()
}

/** The gesture props a variant node reads (#291). */
export interface GestureConfig {
  readonly whileInView?: object | WardicVariantLabels | undefined
  readonly whileFocus?: object | WardicVariantLabels | undefined
  readonly whileHover?: object | WardicVariantLabels | undefined
  readonly whileTap?: object | WardicVariantLabels | undefined
  readonly whileDrag?: object | WardicVariantLabels | undefined
}

/** Each gesture on: its own, or its provider's. */
export const gesturesOn = (own: GestureStates, above: GestureStates): GestureStates => ({
  inView: Bool.or(own.inView, above.inView),
  focused: Bool.or(own.focused, above.focused),
  hovered: Bool.or(own.hovered, above.hovered),
  pressed: Bool.or(own.pressed, above.pressed),
  dragged: Bool.or(own.dragged, above.dragged),
})

/** A gesture's label (#291): its own `while*`, if a name or a list (#297); with none of its own, the one it took. */
const labelOf = (own: object | WardicVariantLabels | undefined, inherited: WardicVariantLabels | undefined): WardicVariantLabels | undefined => {
  if (Predicate.isNotUndefined(own)) return nameOf(own)
  return inherited
}

/** What an element hands down (#291), from its config, its own states, and what it takes. */
export const handDownOf = (config: GestureConfig, own: GestureStates, above: GestureHandDown): GestureHandDown => ({
  on: gesturesOn(own, above.on),
  names: {
    inView: labelOf(config.whileInView, above.names.inView),
    focused: labelOf(config.whileFocus, above.names.focused),
    hovered: labelOf(config.whileHover, above.names.hovered),
    pressed: labelOf(config.whileTap, above.names.pressed),
    dragged: labelOf(config.whileDrag, above.names.dragged),
  },
})

/** The name each gesture's layer resolves while it's on (#291): its label then; off, none. */
export const activeNamesOf = (handDown: GestureHandDown): GestureNames => ({
  inView: activeName(handDown, "inView"),
  focused: activeName(handDown, "focused"),
  hovered: activeName(handDown, "hovered"),
  pressed: activeName(handDown, "pressed"),
  dragged: activeName(handDown, "dragged"),
})

/** A gesture's label while it's on. */
const activeName = (handDown: GestureHandDown, layer: GestureLayer): WardicVariantLabels | undefined => {
  if (Bool.not(handDown.on[layer])) return undefined
  return handDown.names[layer]
}

/** A key for a variant name and the active gestures' names: what a provider's orchestration snapshots at (#291), a list's names each (#297). */
export const triggerKeyOf = (variant: WardicVariantLabels | undefined, handDown: GestureHandDown): string =>
  [keyOfLabels(variant), ...GESTURE_LAYERS.map((layer) => keyOfLabels(activeName(handDown, layer)))].join("|")

/** Labels as one key: a list's names apart by a character no name has in practice. */
const keyOfLabels = (labels: WardicVariantLabels | undefined): string => Arr.join(labelsOf(labels), "\u0001")

/** The highest-priority active gesture's name, or list (#297), if any hands one down. */
export const topGestureName = (names: GestureNames): WardicVariantLabels | undefined =>
  UndefinedOr.match(names.dragged, {
    onDefined: identity,
    onUndefined: () =>
      UndefinedOr.match(names.pressed, {
        onDefined: identity,
        onUndefined: () =>
          UndefinedOr.match(names.hovered, {
            onDefined: identity,
            onUndefined: () => UndefinedOr.match(names.focused, { onDefined: identity, onUndefined: () => names.inView }),
          }),
      }),
  })

export interface WardicVariantContextValue {
  /** The parent's current variant NAME, or list of names (#297), reactive (undefined if it's a values map). */
  readonly variant: Accessor<WardicVariantLabels | undefined>
  /**
   * The parent's `initial` variant NAME, or `false`, read once (undefined if it's a values map or
   * absent): a Variant child with no `initial` of its own starts from it (#50), or, for `false`,
   * at its `animate` (#134, Motion's `getCurrentTreeVariants`).
   */
  readonly initial: WardicVariantLabels | false | undefined
  /** The parent's transition, inherited as the default for children. */
  readonly transition: Accessor<WardicTransition | undefined>
  /**
   * What the parent hands down for its gestures (#291, Motion's): whether each is on, and its label.
   * A Variant child's gesture is on while the parent's is, on its own `while*`, else that label.
   * Optional: left out, nothing.
   */
  readonly gestures?: Accessor<GestureHandDown>
  /**
   * Register this child with the parent's ordered registry (call on mount).
   * Returns the child's reactive snapshot index/total + a settle reporter +
   * a disposer. Children register in mount order; the Provider snapshots that
   * order at each transition trigger (ADR-0007 snapshot-at-trigger).
   */
  readonly register: () => WardicChildRegistration
  /**
   * The parent's resolved stagger config (from `config.transition`): amount =
   * `staggerChildren`, plus `delayChildren` / `from` / `direction`.
   */
  readonly stagger: Accessor<WardicStaggerConfig>
  /**
   * The parent's stagger config for one of its names (#297, Motion's `animateVariant` a name): that
   * name's own transition's, else the parent's `transition`. A Variant child's keys of that name take
   * their delay from it. `undefined` asks for {@link stagger}. Optional: left out, `stagger` for all.
   */
  readonly staggerFor?: (name: string | undefined) => WardicStaggerConfig
  /** The parent's `when` mode, or `undefined` (default concurrent). */
  readonly when: Accessor<"beforeChildren" | "afterChildren" | undefined>
  /**
   * Whether children may START their inherited-variant Retarget yet. True
   * immediately UNLESS `when === "beforeChildren"`, in which case it flips true
   * once the parent's own variant animation settles.
   */
  readonly childrenMayStart: Accessor<boolean>
  /** Whether EVERY registered child has reported its spine as settled. */
  readonly allChildrenSettled: Accessor<boolean>
  /**
   * During a server render, the parent's Appear group (#48, ADR-0044 decision 5): its Variant
   * children join it in render order, for their stagger and `when` before hydration.
   */
  readonly appearGroup?: AppearGroup | undefined
}

/** The part of an element's config its place in variant orchestration reads. */
export interface VariantConfig extends GestureConfig {
  readonly initial?: object | WardicVariantLabels | false | undefined
  readonly animate?: object | WardicVariantLabels | undefined
  readonly variants?: object | undefined
  readonly inherit?: boolean | undefined
  readonly transition?: WardicTransition | undefined
  /** What its dynamic variants resolve with (#277). */
  readonly custom?: unknown
}

/** An `initial` an element hands its children: a variant name or list (#297), `false` (#134), or `undefined` for a values map or nothing. */
export const initialNameOf = (entry: object | WardicVariantLabels | false | undefined): WardicVariantLabels | false | undefined =>
  Bool.match(entry === false, { onTrue: () => false as const, onFalse: () => nameOf(entry as object | WardicVariantLabels | undefined) })

/** A variant name or a list of names (#297), or `undefined` for a values map or nothing. */
export const nameOf = (entry: object | WardicVariantLabels | undefined): WardicVariantLabels | undefined =>
  Bool.match(isLabels(entry), { onTrue: () => entry as WardicVariantLabels, onFalse: constUndefined })

/** Whether `config` names its own variants: its `initial` or `animate` is a name or a list (Motion's `isControllingVariants`, `isVariantLabel`). */
export const namesOwnVariants = (config: VariantConfig): boolean => isLabels(config.initial) || isLabels(config.animate)

/** Whether an element has variants of its own, so Variant children join it (Motion's `isVariantNode`). */
export const hasOwnVariants = (config: VariantConfig): boolean =>
  Predicate.isNotUndefined(config.variants) || namesOwnVariants(config)

/**
 * Whether an element changes what its children read, so it renders its variant context's
 * Provider (#50): it has variants of its own, or it sets `inherit={false}`. Any other element hands
 * its children its parent's context as it is, so it renders none. Decided once, at setup, from the
 * same props on a server and on the client, so the nesting never changes after mount.
 */
export const changesContext = (config: VariantConfig): boolean => hasOwnVariants(config) || config.inherit === false

/** Whether an element is a **Variant child** (CONTEXT.md). */
export const isVariantChild = (config: VariantConfig): boolean =>
  Predicate.isNotUndefined(config.variants) && !namesOwnVariants(config) && config.inherit !== false

/** The context an element inherits names and its default transition from: its parent's, for a Variant child. */
export const inheritedContext = (
  config: VariantConfig,
  parent: WardicVariantContextValue | undefined,
): WardicVariantContextValue | undefined => Bool.match(isVariantChild(config), { onFalse: constUndefined, onTrue: () => parent })

/**
 * The `initial` an element's Starting style resolves: its own, else the `initial` name (or `false`) of
 * the context it inherits from (#50, #134). Read once, as every `initial` is.
 */
export const initialOf = (
  config: VariantConfig,
  inherited: WardicVariantContextValue | undefined,
): object | WardicVariantLabels | false | undefined =>
  UndefinedOr.match(config.initial, {
    onDefined: (initial) => initial,
    onUndefined: () => UndefinedOr.match(inherited, { onUndefined: constUndefined, onDefined: (context) => context.initial }),
  })

/** The `animate` an element starts at with `initial={false}`: its own, else the name its context hands down (#134). Read once, untracked. */
const animateOf = (
  config: VariantConfig,
  inherited: WardicVariantContextValue | undefined,
  untrack: Reactivity["untrack"],
): object | WardicVariantLabels | undefined =>
  UndefinedOr.match(config.animate, {
    onDefined: (animate) => animate,
    onUndefined: () => UndefinedOr.match(inherited, { onUndefined: constUndefined, onDefined: (context) => untrack(context.variant) }),
  })

/**
 * Whether an element starts at its `animate`, with nothing animating at mount (#134, Motion's
 * `isInitialAnimationBlocked`): its `initial` (own or inherited) is `false`, or it renders with an
 * `<AnimatePresence initial={false}>`'s first render (`presenceBlocks`).
 */
export const startsAtAnimate = (
  config: VariantConfig,
  inherited: WardicVariantContextValue | undefined,
  presenceBlocks: boolean,
): boolean => presenceBlocks || initialOf(config, inherited) === false

/**
 * The values an element starts from, its Starting style's input (ADR-0003): its `initial` (own, else
 * inherited, #50), or, when it {@link startsAtAnimate}, its `animate` (own, else inherited), as
 * Motion's `initial={false}` (#134). Read once: an inherited name is read through `untrack`.
 */
export const startingValuesOf = (
  config: VariantConfig,
  inherited: WardicVariantContextValue | undefined,
  presenceBlocks: boolean,
  untrack: Reactivity["untrack"],
): Values.Values =>
  Style.resolveInitial({
    initial: Bool.match(startsAtAnimate(config, inherited, presenceBlocks), {
      onTrue: () => false as const,
      onFalse: () => initialOf(config, inherited),
    }),
    animate: animateOf(config, inherited, untrack),
    // Dynamic variants resolved first (#277): dom's Starting style reads values maps only.
    variants: startingVariantsOf(config.variants, config.custom) as Readonly<Record<string, object | undefined>> | undefined,
  })

/**
 * A name an element hands its children (Motion's `getCurrentTreeVariants`): `own` if it names its own
 * variants, else `fromParent` unless it sets `inherit={false}`.
 */
export const handedDown = <A extends WardicVariantLabels | false>(config: VariantConfig, own: () => A | undefined, fromParent: () => A | undefined): A | undefined =>
  Bool.match(namesOwnVariants(config), {
    onTrue: own,
    onFalse: () => Bool.match(config.inherit === false, { onTrue: constUndefined, onFalse: fromParent }),
  })

/** An element's own transition, else the one it inherits. */
export const ownOrInherited = (own: WardicTransition | undefined, inherited: WardicVariantContextValue | undefined): WardicTransition | undefined =>
  UndefinedOr.match(own, { onUndefined: () => UndefinedOr.map(inherited, (context) => context.transition()), onDefined: identity })

/** The stagger config an element's `transition` gives its Variant children. */
export const staggerOf = (transition: WardicTransition | undefined): WardicStaggerConfig =>
  UndefinedOr.match(transition, { onUndefined: () => staggerWith({}), onDefined: staggerWith })

/** A context's stagger config for one of its names (#297): its `staggerFor`'s, else its whole orchestration's. */
export const staggerOfName = (context: WardicVariantContextValue, name: string | undefined): WardicStaggerConfig => {
  const of = context.staggerFor
  if (Predicate.isUndefined(of)) return context.stagger()
  return of(name)
}

/** A child's place in a stagger, turned by its `staggerDirection`: `-1` counts from the last. */
export const directed = (index: number, total: number, direction: 1 | -1): number => {
  if (direction === -1) return total - 1 - index
  return index
}

/** The stagger config of a transition's stagger keys, each defaulted. */
export const staggerWith = ({ staggerChildren = 0, delayChildren = 0, from = "first", staggerDirection = 1 }: WardicTransition): WardicStaggerConfig => ({
  amount: staggerChildren,
  delayChildren,
  from,
  direction: staggerDirection,
})

/** What an element provides when it has no variants of its own: its parent's context, unless `inherit={false}`. */
export const passedThrough = (
  config: VariantConfig,
  parent: WardicVariantContextValue | undefined,
): WardicVariantContextValue | undefined => Bool.match(config.inherit === false, { onTrue: constUndefined, onFalse: () => parent })

/** A registration that does nothing: a server render has no orchestration to join. */
export const INERT_REGISTRATION: WardicChildRegistration = Object.freeze({
  index: () => 0,
  total: () => 1,
  setSettled: () => {},
  dispose: () => {},
})

/** An element's place in variant orchestration during a server render (ADR-0021). */
export interface ServerVariantNode {
  /** What its children read: the same context the client builds, with inert orchestration. */
  readonly provided: WardicVariantContextValue | undefined
  /** The context it inherits from: its parent's, for a Variant child. */
  readonly inherited: WardicVariantContextValue | undefined
}

/**
 * {@link createVariantNode} during a server render: the same names, read once, and orchestration
 * that does nothing. No runtime, no signals.
 */
export const serverVariantNode = (config: VariantConfig, parent: WardicVariantContextValue | undefined): ServerVariantNode => {
  const inherited = inheritedContext(config, parent)
  const own = (): WardicVariantContextValue => {
    const variant = handedDown(config, () => nameOf(config.animate), () => UndefinedOr.map(parent, (p) => p.variant()))
    const transition = ownOrInherited(config.transition, inherited)
    const stagger = staggerOf(config.transition)
    return {
      variant: () => variant,
      initial: handedDown<WardicVariantLabels | false>(config, () => initialNameOf(config.initial), () => UndefinedOr.map(parent, (p) => p.initial)),
      transition: () => transition,
      register: () => INERT_REGISTRATION,
      stagger: () => stagger,
      when: () => UndefinedOr.map(config.transition, (t) => t.when),
      childrenMayStart: constTrue,
      allChildrenSettled: constTrue,
    }
  }
  return {
    provided: Bool.match(hasOwnVariants(config), { onTrue: own, onFalse: () => passedThrough(config, parent) }),
    inherited,
  }
}
