/**
 * The motion spine's Retarget (ADR-0005), Solid-free (#209): what an element does from its mount on
 * when its target changes, for the Solid 1 binding (`create-ward.tsx`'s `runSpine`) and the Solid 2
 * one (`unstable/v2/ward.tsx`) alike. A binding mounts the element, resolves its Override stack
 * reactively ({@link resolutionOf}), and calls {@link ElementSpine.retarget} on each change, read
 * where its Solid doesn't track; everything a Retarget does is here:
 *
 *   end the running legs -> carry the keys no layer sets back to their Base values (ADR-0022) ->
 *   start each key from its Snapshot (ADR-0024) -> take over an Appear animation (ADR-0044) ->
 *   build the legs (`retarget-legs.ts`) and run each into the gate -> `gate.write`.
 *
 * With it, the helpers both bindings' Wards share: the Starting values, the Base values' start links,
 * the sink wrappers, and what a server render reads.
 *
 * @module
 */
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import * as Override from "@wardic/core/Override"
import * as Projection from "@wardic/core/Projection"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Renderer from "@wardic/core/Renderer"
import * as Supersede from "@wardic/core/Supersede"
import * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as OwnValues from "@wardic/dom/OwnValues"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Variables from "@wardic/dom/Variables"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Equivalence from "effect/Equivalence"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import { constFalse, constUndefined, constVoid, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { enterServer, type Handoff, keyOf, type MountAnimation, repeatsForever, type ServerAppear, startAtOf } from "./appear.ts"
import type {
  WardConfig,
  WardicAnimationDefinition,
  WardicTransition,
  WardicVariant,
  WardicVariantLabels,
  WardicVariants,
  WardicVariantTransition,
} from "./config.ts"
import { type LiveStyle, serverRegistryOf, valuesOf } from "./live-style.ts"
import { type ExitGroup, type PresenceContextValue, type PresenceExit, presenceMade, type PresenceRecord, type PresenceSeed, type PresenceTree } from "./presence-record.ts"
import type { DragTrack } from "./drag-track.ts"
import type { Accessor, Reactivity } from "./reactivity.ts"
import { delayedBy, type Follows, type Leg, legsOf, startingAt } from "./retarget-legs.ts"
import type { WardicRuntime, WardicServices } from "./runtime.ts"
import {
  changesContext,
  hasOwnVariants,
  GESTURE_LAYERS,
  type GestureLayer,
  type GestureNames,
  type NameOrchestration,
  activeNamesOf,
  type GestureHandDown,
  gesturesOn,
  type GestureStates,
  handDownFrom,
  handDownOf,
  NO_GESTURE_STATES,
  NO_HAND_DOWN,
  isVariantChild,
  nameOf,
  NO_GESTURE_NAMES,
  ownOrInherited,
  type ServerVariantNode,
  startingValuesOf,
  startsAtAnimate,
  type WardicVariantContextValue,
} from "./variant-tree.ts"
import { type Entry, mergedOf, type NamedTarget, NO_VARIANT_STATE, resolveTarget, resolveTargets, sameLabels, type Target, transitionOfTarget, type VariantState } from "./variant-target.ts"

export { NO_VARIANT_STATE, resolveTarget, type Target, transitionOfTarget, type VariantState } from "./variant-target.ts"

/** What an element's exit is resolved from (#277): its last config, kept current while it's alive. */
export interface ExitConfig {
  readonly exit: WardicVariant | WardicVariantLabels | undefined
  readonly variants: WardicVariants | undefined
  readonly custom: unknown
  /** Its `transition`, or the one it inherits. */
  readonly transition: WardicTransition | undefined
}

/** No exit: an element outside a presence never resolves one. */
export const NO_EXIT_CONFIG: ExitConfig = { exit: undefined, variants: undefined, custom: undefined, transition: undefined }

/** A record's place in the variant tree (#290), from its config at setup. */
export const presenceTreeOf = (c: WardConfig): PresenceTree => ({
  joins: isVariantChild(c),
  provides: changesContext(c),
  twin: Predicate.isNotUndefined(c.layoutId),
})

/**
 * An element's ref that tells its presence it was made (#286, ADR-0048): its `key`, read once, and
 * whether it's a twin. With no presence, `set` itself: nothing is made per element.
 */
export const madeWith = <E extends Element>(presence: PresenceContextValue | undefined, set: (el: E) => void, c: WardConfig): ((el: E) => void) => {
  if (Predicate.isUndefined(presence)) return set
  const key = c.key
  const twin = Predicate.isNotUndefined(c.layoutId)
  return (el) => {
    presenceMade(presence, el, key, twin)
    set(el)
  }
}

/** An element's {@link ExitConfig} from its config now. */
export const exitConfigOf = (c: WardConfig, parent: WardicVariantContextValue | undefined): ExitConfig => ({
  exit: c.exit,
  variants: c.variants,
  custom: c.custom,
  transition: ownOrInherited(c.transition, parent),
})

/** An exit resolved (#277): its values, and the transition it runs on. */
export type ExitTarget = PresenceExit

/**
 * Resolve an element's exit as it leaves (#277): with its `<AnimatePresence custom>` when that's
 * given (Motion's: the leaving element's own props can't change any more), else its own `custom`; on
 * its own transition, else the element's.
 */
export const exitTargetOf = (config: ExitConfig, presenceCustom: unknown, state: VariantState, inherited: WardicVariantLabels | undefined): ExitTarget => {
  const custom = UndefinedOr.match(presenceCustom, { onUndefined: () => config.custom, onDefined: identity })
  // Its own `exit` wins; a Variant child with none exits on the name its provider hands down (#290).
  const entry: Entry = UndefinedOr.match(config.exit, { onDefined: identity, onUndefined: (): Entry => inherited })
  const name = UndefinedOr.match(nameOf(config.exit), { onDefined: identity, onUndefined: () => inherited })
  if (Array.isArray(entry)) {
    // A list (#297): merged, and each name's own keys on its own transition.
    const targets = resolveTargets(entry, config.variants, custom, state)
    const merged = mergedOf(targets)
    return {
      values: merged.values,
      transition: transitionOfTarget(merged.transition, config.transition),
      name,
      groups: exitGroupsOf(targets, config.transition),
    }
  }
  const target = resolveTarget(entry, config.variants, custom, state)
  return { values: target.values, transition: transitionOfTarget(target.transition, config.transition), name }
}

/** A list's exit groups (#297): each name, with the keys it's the last to set, on its own transition else `element`. */
const exitGroupsOf = (targets: ReadonlyArray<NamedTarget>, element: WardicTransition | undefined): ReadonlyArray<ExitGroup> =>
  Arr.map(targets, (target, i) => ({
    name: target.name as string,
    values: Rec.filter(target.values, (_, key) => Bool.not(Arr.some(Arr.drop(targets, i + 1), (later) => Object.hasOwn(later.values, key)))),
    transition: transitionOfTarget(target.transition, element),
  }))

/** A config given as a value or as an accessor, as an accessor. A config is always an object, so a function is the accessor. */
export const accessorOf = <A extends object>(config: A | Accessor<A>): Accessor<A> =>
  Bool.match(Predicate.isFunction(config), { onTrue: () => config as Accessor<A>, onFalse: () => () => config as A })

/**
 * `transition` with a stagger delay folded into its own and its entries' (ADR-0007, #301), reused
 * while its fields are (#66).
 */
const staggeredOf = (
  transition: WardicTransition | undefined,
  extra: number,
  reuse: (transition: WardicTransition) => WardicTransition,
): WardicTransition | undefined => UndefinedOr.map(delayedBy(transition, extra), reuse)

/**
 * A Retarget's keys by the layer that drives each (#291), when an active layer (the base's included)
 * has its own transition: the highest active layer that sets it, and the base for a key none sets (a
 * return). `undefined` when none has: one transition for every key.
 */
const keysByLayerOf = (
  t: Values.Values,
  layers: ReadonlyArray<Layer>,
  extraDelay: ((name: string | undefined) => number) | undefined,
  extra: number,
  listed: boolean,
  shut: ReadonlyArray<boolean> | undefined,
): ReadonlyArray<ReadonlySet<string>> | undefined => {
  if (Bool.not(Bool.or(Bool.or(Arr.some(layers, hasOwnTransition), delaysDiffer(layers, extraDelay, extra)), anyShutOf(shut)))) return undefined
  // A list's returns in a group of their own, after its layers' (#297).
  let returnsAt = 0
  if (listed) returnsAt = layers.length
  const groups = Arr.makeBy(Math.max(layers.length, returnsAt + 1), () => new Set<string>())
  Arr.forEach(Rec.keys(t), (key) => {
    const at = Option.getOrElse(Arr.findLastIndex(layers, (layer) => Bool.and(layer.active, Object.hasOwn(layer.values, key))), () => returnsAt)
    UndefinedOr.map(groups[at], (group) => group.add(key))
  })
  return groups
}

/** `t`'s keys in the `i`th group, or all of them when there are no groups. */
const pickKeys = (t: Values.Values, groups: ReadonlyArray<ReadonlySet<string>> | undefined, i: number): Values.Values => {
  if (Predicate.isUndefined(groups)) return t
  const group = groups[i]
  if (Predicate.isUndefined(group)) return {}
  return Rec.filter(t, (_, key) => group.has(key))
}

/** A transition's `delay`, 0 without one. */
export const delayOf = (transition: WardicTransition | undefined): number =>
  UndefinedOr.match(transition, { onUndefined: () => 0, onDefined: ({ delay = 0 }) => delay })

/** The keys a drag of `axis` moves directly. Built once, at module load. */
const dragMovesOf: (axis: boolean | "x" | "y") => ReadonlyArray<string> = Match.type<boolean | "x" | "y">().pipe(
  Match.when("x", (): ReadonlyArray<string> => ["x"]),
  Match.when("y", (): ReadonlyArray<string> => ["y"]),
  Match.orElse((): ReadonlyArray<string> => ["x", "y"]),
)

/** Whether a start link's value takes its target's shape: both numbers, or both strings. */
const isSameKind = (value: number | string, like: number | string): boolean => Predicate.isNumber(value) === Predicate.isNumber(like)

/** The keys a drag direct-sets (ADR-0004) and a projection owns (ADR-0016). */
const TRANSLATE_KEYS: ReadonlySet<string> = new Set(["x", "y", "translateX", "translateY"])
const TRANSLATE_KEY_LIST: ReadonlyArray<string> = Arr.fromIterable(TRANSLATE_KEYS)

/** Whether a value map has any key. */
const hasKeys: Predicate.Predicate<Values.Values> = Predicate.not(Rec.isEmptyRecord)

/**
 * Whether two transitions have the same keys, each holding the same value (`===`), an entry the
 * same fields (#301: a stagger makes each entry anew).
 */
const sameFields = (a: object, b: object): boolean => {
  const ra = a as Readonly<Record<string, unknown>>
  const rb = b as Readonly<Record<string, unknown>>
  const keys = Rec.keys(ra)
  return Bool.and(keys.length === Rec.keys(rb).length, Arr.every(keys, (key) => Bool.and(key in rb, sameField(ra[key], rb[key]))))
}

/** Whether two fields are the same: `===`, or two entries with the same fields (#301). */
const sameField = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Bool.and(Predicate.isObject(a), Predicate.isObject(b))) return sameFields(a as object, b as object)
  return false
}

/** The Override stack resolved: a Retarget's input. */
export interface Resolution {
  /** Each key's value from the highest active layer. */
  readonly resolved: Values.Values
  /** The base layer, the first link of a key's Base value (ADR-0022). */
  readonly base: Values.Values
  /** Whether a drag holds the translate keys (ADR-0004's strip). */
  readonly dragging: boolean
  /** The variant name (or list, #297) the base layer resolved: its own `animate`'s, else the one it inherits; none for a values map. */
  readonly variant: WardicVariantLabels | undefined
  /** The layers it was resolved with (#257): a landing's gestures are the ones its Retarget started with. */
  readonly active: Active
  /** The base target's own transition (#277): the keys the base layer drives animate on it. */
  readonly transition: WardicVariantTransition | undefined
  /**
   * The Override stack's layers (#291): the base, then each gesture's, lowest first. A Retarget runs
   * each key on the own transition of the highest active layer that sets it.
   */
  readonly layers: ReadonlyArray<Layer>
  /** The names its active gesture layers resolved (#291): its own `while*` names, else those it took. */
  readonly names: GestureNames
}

/**
 * One layer of the Override stack (#291): whether it's on, its values, its target's own transition,
 * and the variant name it resolved (#297), `undefined` for a values map. A list of names is a layer
 * a name, in order.
 */
export interface Layer {
  readonly active: boolean
  readonly values: Values.Values
  readonly transition: WardicVariantTransition | undefined
  readonly name: string | undefined
}

/** A gesture layer that's off: nothing is resolved for it. */
const OFF: Layer = { active: false, values: {}, transition: undefined, name: undefined }

/**
 * A gesture's layer (#291), while it's on (its own, or its provider's): its own `while*` (a target, or
 * a variant name), else the label its provider hands down. Off, or with neither, nothing is resolved.
 */
const gestureLayersInto = (
  layers: Array<Layer>,
  own: Entry,
  on: boolean,
  label: WardicVariantLabels | undefined,
  variants: WardicVariants | undefined,
  custom: unknown,
  state: VariantState,
): void => {
  if (Bool.not(on)) {
    layers.push(OFF)
    return
  }
  const entry = UndefinedOr.match(own, { onDefined: identity, onUndefined: (): Entry => label })
  if (Predicate.isUndefined(entry)) {
    layers.push(OFF)
    return
  }
  // A list is a layer a name, in order (#297): the last name that sets a key drives it.
  if (Array.isArray(entry)) {
    Arr.forEach(resolveTargets(entry, variants, custom, state), (target) => layers.push(namedLayerOf(target)))
    return
  }
  layers.push(layerOf(resolveTarget(entry, variants, custom, state), labelOrUndefined(entry)))
}

/** A single entry's name: itself, if a name; `undefined` for a values map. */
const labelOrUndefined = (entry: Entry): string | undefined => Bool.match(Predicate.isString(entry), { onTrue: () => entry as string, onFalse: constUndefined })

/** Each gesture on: the element's own, or its provider's too when it has one handing any down. */
const gesturesOnOf = (active: Active, above: GestureHandDown): GestureStates => {
  if (above === NO_HAND_DOWN) return active
  return gesturesOn(active, above.on)
}

/**
 * The name each gesture's layer resolves while it's on (#291): its own `while*`, if a name, else the
 * label it took. With none on, the shared empty one: nothing made.
 */
const activeNamesFor = (c: WardConfig, on: GestureStates, labels: GestureNames): GestureNames => {
  if (Bool.not(anyOn(on))) return NO_GESTURE_NAMES
  return activeNamesOf(handDownOf(c, on, { on: NO_GESTURE_STATES, names: labels }))
}

/** Whether any gesture is on: per Retarget, so no closure. */
const anyOn = (on: GestureStates): boolean => on.inView || on.focused || on.hovered || on.pressed || on.dragged

/**
 * Whether an active layer's name delays its keys otherwise than the first layer's (#297): a Variant
 * child's names each take their own stagger slot. Never for an element that joins none, nor for one
 * layer.
 */
const delaysDiffer = (layers: ReadonlyArray<Layer>, extraDelay: ((name: string | undefined) => number) | undefined, extra: number): boolean => {
  if (Bool.or(Predicate.isUndefined(extraDelay), layers.length < 2)) return false
  return Arr.some(layers, (layer) => Bool.and(layer.active, extraOf(extraDelay, layer) !== extra))
}

/** A layer's stagger delay (ADR-0007, #297): its name's, for a Variant child; 0 for any other element. */
const extraOf = (extraDelay: ((name: string | undefined) => number) | undefined, layer: Layer | undefined): number => {
  if (Predicate.isUndefined(extraDelay)) return 0
  if (Predicate.isUndefined(layer)) return extraDelay(undefined)
  return extraDelay(layer.name)
}

/**
 * The transition a key group runs on (#291, #297): unsplit, the base's (`transition`, its delay
 * folded in); split, its layer's own, else the element's, at its name's delay. A list's first
 * group carries its returns too, which run on the element's transition, as a list's base has no one
 * transition of its own.
 */
const groupTransitionOf = (
  resolution: Resolution,
  groups: ReadonlyArray<ReadonlySet<string>> | undefined,
  i: number,
  transition: WardicTransition | undefined,
  element: WardicTransition | undefined,
  extraDelay: ((name: string | undefined) => number) | undefined,
  reuse: (transition: WardicTransition) => WardicTransition,
): WardicTransition | undefined => {
  if (Predicate.isUndefined(groups)) return transition
  if (Bool.and(i === 0, Bool.not(Array.isArray(resolution.variant)))) return transition
  const layer = resolution.layers[i]
  // A list's returns: the element's, at its whole orchestration's delay.
  if (Predicate.isUndefined(layer)) return staggeredOf(element, extraOf(extraDelay, undefined), reuse)
  return staggeredOf(transitionOfTarget(layer.transition, element), extraOf(extraDelay, layer), reuse)
}

/** No names. */
const NO_NAMES: ReadonlyArray<string> = []

/** No legs. */
const NO_LEGS: ReadonlyArray<Leg> = []

/**
 * Where a Retarget's legs land (#257, #325): what each running leg's frames and end are told to.
 * The last Retarget's, which every running leg counts toward, the ones it carried included.
 */
interface Landing {
  /** A leg drew a frame: its last, when `done`. */
  readonly report: (done: boolean) => void
  /** A leg settled. */
  readonly settled: () => void
  /** A leg failed (#257 item 4). */
  readonly failed: (cause: Cause.Cause<unknown>) => void
}

/**
 * A gated Retarget's landing (ADR-0007 `when`, #325): the legs it carries report the element
 * unsettled, as it still owes an animation, and land nothing; the Retarget once the gate opens
 * counts them.
 */
const gatedLandingOf = (onFrame: ((done: boolean) => void) | undefined): Landing => ({
  report: () => {
    if (Predicate.isNotUndefined(onFrame)) onFrame(false)
  },
  settled: constVoid,
  failed: constVoid,
})

/**
 * A running leg (#325): the keys it draws, each with the target its Retarget resolved, and the
 * landing its frames and end count toward. It's its machines' run options, with its own token
 * (#200): a later Retarget that resolves a key to the same target leaves the leg that key, every
 * other key is given up, and a leg left with none is ended.
 */
interface Running extends Machine.RunOptions {
  /** Each key it animates, with the target its Retarget gave it. */
  readonly targets: Values.Values
  /** The resolution of the Retarget that started it: a `when` gate holds that change's legs. */
  readonly resolution: Resolution
  /** How many of its keys it still draws. */
  count: number
  /** A frame's values for the keys it still draws: the frame's own while it draws all of them. */
  values: (value: Values.Values) => Values.Values
  /** The same, for a frame's velocities. */
  velocities: (velocity: Readonly<Record<string, number>>) => Readonly<Record<string, number>>
  /** It drew its last frame: its keys landed. */
  done: boolean
  /** It gave up a key in this Retarget: what it still draws is worked out at the Retarget's end. */
  losing: boolean
  fiber: Fiber.Fiber<void> | undefined
  /** The landing it counts toward: its Retarget's, then the one of each Retarget that carried it. */
  landing: Landing
  /** A list's names its end is told to (#297), for the Retarget it counts toward. */
  names: ((end: unknown) => void) | undefined
}

/** No running legs. */
const NO_RUNNING: ReadonlyArray<Running> = []

/** No values: what a spine's Retarget keys are before its first. */
const NO_VALUES: Values.Values = {}

/**
 * Each key's Leg (#325): the one that draws it, or the last one that did, landed; `undefined` once
 * none does. A key's entry is cleared in place, never deleted: a Retarget that gives up and restarts
 * every key would otherwise leave the Map a hole a key each time, and rehash it.
 */
type Owners = Map<string, Running | undefined>

/** A Leg's run ended at an unmount, unless it landed. Hoisted: called per key at each unmount. */
const endUnlessLanded = (running: Running | undefined): void => {
  if (Predicate.isUndefined(running)) return
  if (Bool.not(running.done)) Supersede.end(running.supersede)
}

/** A leg over the keys of `to` (#325), counting toward `landing`: the spine gives it the keys. */
const runningOf = (to: Values.Values, resolution: Resolution, landing: Landing): Running => ({
  supersede: Supersede.make(),
  targets: to,
  resolution,
  count: 0,
  values: identity,
  velocities: identity,
  done: false,
  losing: false,
  fiber: undefined,
  landing,
  names: undefined,
})

/** A leg's frame drawn (#325): its last lands the keys it draws. Per frame: plain calls. */
const drew = (running: Running, done: boolean): void => {
  if (done) running.done = true
  running.landing.report(done)
}

/**
 * A frame's values for `kept` alone (#325): a leg a later Retarget took keys from draws only the
 * rest. Built once, when it gives them up; each frame copies into the one object it returns.
 */
const keepingOnly = <A,>(kept: ReadonlyArray<string>): ((value: Readonly<Record<string, A>>) => Readonly<Record<string, A>>) => {
  const out: Record<string, A> = {}
  let frame: Readonly<Record<string, A>> = out
  const copy = (key: string): void => {
    out[key] = frame[key] as A
  }
  return (value) => {
    frame = value
    Arr.forEach(kept, copy)
    return out
  }
}

/** The groups of the keys a carried leg draws (#297, #325): the first alone when the keys aren't split. */
const groupsOfLeg = (running: Running, groups: ReadonlyArray<ReadonlySet<string>> | undefined, owners: Owners): ReadonlyArray<number> => {
  if (Predicate.isUndefined(groups)) return [0]
  const keys = Arr.filter(Rec.keys(running.targets), (key) => owners.get(key) === running)
  return Arr.filter(Arr.makeBy(groups.length, identity), (g) => Arr.some(keys, (key) => UndefinedOr.match(groups[g], { onUndefined: constFalse, onDefined: (group) => group.has(key) })))
}

/** Each layer's gate shut now (#297's PR 2): a named one whose `when` holds its keys back. */
const shutOf = (layers: ReadonlyArray<Layer>, byName: NameOrchestration | undefined): ReadonlyArray<boolean> | undefined => {
  if (Predicate.isUndefined(byName)) return undefined
  return Arr.map(layers, (layer) => {
    const name = layer.name
    if (Predicate.isUndefined(name)) return false
    return Bool.not(byName.mayStart(name))
  })
}

/** Whether any layer's gate is shut (#297's PR 2): none without a list. */
const anyShutOf = (shut: ReadonlyArray<boolean> | undefined): boolean => {
  if (Predicate.isUndefined(shut)) return false
  return Arr.some(shut, identity)
}

/** A split Retarget's legs, each key group's (#291, #297), and the group each leg animates. */
interface SplitLegs {
  readonly legs: ReadonlyArray<Leg>
  readonly tags: ReadonlyArray<number>
}

/**
 * A split Retarget's legs (#291, #297): each key group on its transition, over the keys that start a
 * leg (`t`, #325). A group with none of them makes no leg: a list's settles at once as Motion's empty
 * variant does, unless keys it drives stay running. A list's returns' Live values follow with its
 * returns' group, last; any other's with the first group.
 */
const splitLegsOf = (
  t: Values.Values,
  from: Values.Values,
  groups: ReadonlyArray<ReadonlySet<string>>,
  resolution: Resolution,
  listed: boolean,
  transition: WardicTransition | undefined,
  element: WardicTransition | undefined,
  extraDelay: ((name: string | undefined) => number) | undefined,
  reuse: (transition: WardicTransition) => WardicTransition,
  reduce: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  velocities: Readonly<Record<string, number>>,
  follow: Follows | undefined,
): SplitLegs => {
  let returnsAt = 0
  if (listed) returnsAt = resolution.layers.length
  const legs: Array<Leg> = []
  const tags: Array<number> = []
  Arr.forEach(groups, (_, i) => {
    // A group whose keys all stay starts none (#325), as one that drives no key.
    const picked = pickKeys(t, groups, i)
    if (Rec.isEmptyRecord(picked)) return
    let followed: Follows | undefined
    if (i === returnsAt) followed = follow
    const groupLegs = legsOf(from, picked, groupTransitionOf(resolution, groups, i, transition, element, extraDelay, reuse), reduce, positionalKeys, velocities, followed)
    Arr.forEach(groupLegs, (built) => {
      legs.push(built)
      tags.push(i)
    })
  })
  return { legs, tags }
}

/** What a list's names make of a Retarget (#297): their settles told, and each shut one's legs' gate. */
interface Listing {
  readonly names: NameSettles | undefined
  readonly legGates: ReadonlyArray<string | undefined> | undefined
}

/** What {@link listingOf} reads of a Retarget. */
interface ListingOf {
  readonly listed: boolean
  readonly told: ToldNames | undefined
  readonly byName: NameOrchestration | undefined
  readonly resolution: Resolution
  readonly groups: ReadonlyArray<ReadonlySet<string>> | undefined
  readonly legGroups: ReadonlyArray<number> | undefined
  readonly legCount: number
  /** For each running leg it carries (#325), the groups of the keys it draws. */
  readonly carriedGroups: ReadonlyArray<ReadonlyArray<number>>
  readonly shut: ReadonlyArray<boolean> | undefined
  /** Write a shut group's keys where they start. */
  readonly hold: (group: number) => void
  readonly afterFlush: (fn: () => void) => void
  readonly config: WardConfig
}

/**
 * A list's names at a Retarget (#297): told settled as the legs of the keys each drives settle, to
 * the binding's callbacks (Solid 1's, PR 1) and to its orchestration (PR 2), told moving now; and each
 * shut name's legs waiting on its gate (PR 2), its keys held where they start, so another name's first
 * commit, which hands the element's style back (ADR-0034), doesn't drop them to their CSS value.
 */
const listingOf = (of: ListingOf): Listing => {
  const { listed, told, byName, resolution, groups, legGroups, legCount, carriedGroups, shut, config } = of
  const listNames = Bool.match(listed, { onTrue: () => resolution.variant as ReadonlyArray<string>, onFalse: () => NO_NAMES })
  const orchestrated = Bool.and(listed, Predicate.isNotUndefined(byName))
  const toldNames = UndefinedOr.match(told, { onUndefined: () => NO_NAMES, onDefined: (list) => list.names })
  let names: NameSettles | undefined
  if (Bool.or(orchestrated, Predicate.isNotUndefined(told))) {
    if (orchestrated) (byName as NameOrchestration).moving(listNames)
    names = nameSettlesOf(Arr.dedupe([...listNames, ...toldNames]), resolution, groups, legGroups, legCount, carriedGroups, (settled) =>
      of.afterFlush(() => {
        UndefinedOr.map(told, (list) => {
          const mine = Arr.filter(settled, (name) => Arr.contains(list.names, name))
          if (mine.length > 0) list.tell(mine, config)
        })
        if (orchestrated) (byName as NameOrchestration).settled(Arr.filter(settled, (name) => Arr.contains(listNames, name)))
      }))
  }
  let legGates: ReadonlyArray<string | undefined> | undefined
  if (Bool.and(anyShutOf(shut), Predicate.isNotUndefined(legGroups))) {
    const closed = shut as ReadonlyArray<boolean>
    legGates = Arr.map(legGroups as ReadonlyArray<number>, (g) => gateNameOf(resolution.layers, closed, g))
    Arr.forEach(closed, (isShut, g) => {
      if (isShut) of.hold(g)
    })
  }
  return { names, legGates }
}

/** The name a leg of key group `g` waits for, if its layer's gate is shut (#297's PR 2): a list's returns wait for none. */
const gateNameOf = (layers: ReadonlyArray<Layer>, shut: ReadonlyArray<boolean>, g: number): string | undefined => {
  if (shut[g] !== true) return undefined
  return UndefinedOr.match(layers[g], { onUndefined: constUndefined, onDefined: (layer) => layer.name })
}

/** A gate's wait (#297's PR 2): done once `open()` says so, read each tick. */
const gateWaitOf = (open: () => boolean): Machine.Machine<Frame.Frame<undefined>> =>
  Machine.make({ settles: true, span: GATE_SPAN, start: () => () => ({ value: undefined, done: open() }) })

const GATE_SPAN = { name: "wardic.spine.whenGate", attributes: {} }

/** Nothing drawn while a gate is waited on. */
const NO_SINK = (): undefined => undefined

/**
 * A leg that waits for its name's gate first (#297's PR 2), as Motion runs a variant's `when` per
 * name: started once the gate opens, on the same token, so a later Retarget ends the wait as it ends
 * a leg. Without a name, the leg as it is.
 */
const gatedBy = <R,>(
  name: string | undefined,
  byName: NameOrchestration | undefined,
  options: Machine.RunOptions,
  program: Effect.Effect<unknown, never, R>,
): Effect.Effect<unknown, never, R | FrameLoop.FrameLoop> => {
  if (Bool.or(Predicate.isUndefined(name), Predicate.isUndefined(byName))) return program
  const orchestration = byName as NameOrchestration
  const gated = name as string
  return gateWaitOf(() => orchestration.mayStart(gated)).pipe(
    Machine.run(NO_SINK, options),
    Effect.flatMap((end) => Bool.match(Supersede.isSuperseded(end), { onTrue: () => Effect.succeed(end as unknown), onFalse: () => program })),
  )
}

/** Whether a layer is on with its own transition: hoisted, as it's asked per Retarget. */
const hasOwnTransition = (layer: Layer): boolean => Bool.and(layer.active, Predicate.isNotUndefined(layer.transition))

/** A target as an active layer, with the name it resolved. */
const layerOf = (target: Target, name: string | undefined): Layer => ({ active: true, values: target.values, transition: target.transition, name })

/** A list's target as an active layer (#297). */
const namedLayerOf = (target: NamedTarget): Layer => ({ active: true, values: target.values, transition: target.transition, name: target.name })


/** Two values maps with the same keys, each holding the same value. Built once, at module load. */
const sameValues: Equivalence.Equivalence<Values.Values> = Rec.makeEquivalence(Equivalence.strictEqual<number | string>())

/**
 * Whether two resolutions are the same target (#209): the same values for the same keys, in the
 * base layer and resolved, the same drag, and the same variant name. Motion's rule: a config that
 * resolves to the same values doesn't animate (a `transition` change applies from the next
 * change), and a new variant name does, even to the same values. The Solid 2 binding's target memo
 * compares with it, so a `style` or `transition` change in a ward's config doesn't Retarget.
 */
export const sameResolution = (a: Resolution, b: Resolution): boolean =>
  Bool.every([a.dragging === b.dragging, sameLabels(a.variant, b.variant)]) && sameValues(a.resolved, b.resolved) && sameValues(a.base, b.base)

/** Whether `resolution` is `last` with only its `dragging` handed back (#340). */
const handsBackOnly = (resolution: Resolution, last: Resolution | undefined): boolean =>
  UndefinedOr.match(last, { onUndefined: () => false, onDefined: (l) => sameResolution({ ...resolution, dragging: l.dragging }, l) })

/** Motion's `definition` of an animation (#257): a variant name, or its target values. */
export type AnimationDefinition = WardicVariantLabels | Values.Values

/**
 * A Retarget's `definition`, as Motion's `onAnimationStart` / `onAnimationComplete` hand it over
 * (#257): the variant name its base layer resolved, when that name differs from the last started
 * Retarget's (`previous`), else the target's values. Motion's definition is per animation type: a
 * new `animate` variant animates as its name, and a gesture turning on or off as values (its own,
 * or the keys it leaves falling back), so a variant's name is only told when the variant changed.
 */
export const definitionOf = (resolution: Resolution, previous: Resolution | undefined): AnimationDefinition => {
  const name = resolution.variant
  // A list is told as a list (#297): a change name by name, as Motion's `checkVariantsDidChange`.
  if (Bool.and(Predicate.isNotUndefined(name), Bool.not(sameLabels(name, UndefinedOr.map(previous, (p) => p.variant))))) return name as WardicVariantLabels
  // A gesture's name that just came on (#291), the highest first, as Motion's names its type's.
  const before = UndefinedOr.match(previous, { onUndefined: () => NO_GESTURE_NAMES, onDefined: (p) => p.names })
  const started = Arr.findFirst(GESTURES_DOWN, (layer) =>
    Bool.and(Predicate.isNotUndefined(resolution.names[layer]), Bool.not(sameLabels(resolution.names[layer], before[layer]))))
  return Option.match(started, { onNone: (): AnimationDefinition => resolution.resolved, onSome: (layer) => resolution.names[layer] as WardicVariantLabels })
}

/** The gesture layers, highest first. */
const GESTURES_DOWN: ReadonlyArray<GestureLayer> = Arr.reverse(GESTURE_LAYERS)

/**
 * What a Retarget tells its binding (#257): that it started, and that its last leg settled. Each is
 * handed the Retarget's resolution, the variant name the last started Retarget resolved before it
 * (for {@link definitionOf}), and the config it read.
 */
export interface AnimationHooks {
  /** A Retarget started its legs (the `when` gate let it); with no leg, it settles at once. */
  readonly started: (resolution: Resolution, previous: Resolution | undefined, config: WardConfig) => void
  /** That Retarget's last leg settled: not for one the next Retarget superseded, nor one a leg's failure cut off. */
  readonly settled: (resolution: Resolution, previous: Resolution | undefined, config: WardConfig) => void
  /**
   * A leg of that Retarget failed (#257 item 4): it can't land. Told once a Retarget, at once (a
   * leg that fails before it writes leaves no flush to wait for), and never before `started`; the
   * failure is logged and reported apart (ADR-0030).
   */
  readonly failed?: ((resolution: Resolution, error: unknown) => void) | undefined
  /**
   * Names of a list that settled (#297): a binding told each name's end on its own (Solid 1's
   * callbacks, Motion's `animateVariant` a name) has it, called as the legs of the keys each drives
   * settle; one with none hears the list's end through `settled` alone.
   */
  readonly namesSettled?: ((names: ReadonlyArray<string>, config: WardConfig) => void) | undefined
}

/** A list a Retarget tells settled name by name (#297): its names, and what it tells. */
interface ToldNames {
  readonly names: ReadonlyArray<string>
  readonly tell: (names: ReadonlyArray<string>, config: WardConfig) => void
}

/** Whether a resolution resolved a list (#297): its base, or an active gesture's. Cheap for the common case. */
const hasList = (resolution: Resolution): boolean => {
  if (Array.isArray(resolution.variant)) return true
  if (resolution.names === NO_GESTURE_NAMES) return false
  return Arr.some(GESTURE_LAYERS, (layer) => Array.isArray(resolution.names[layer]))
}

/** The list a Retarget tells settled name by name (#297): when its binding is told so, and its definition is a list. */
const namesToldOf = (animation: AnimationHooks | undefined, resolution: Resolution, previous: Resolution | undefined): ToldNames | undefined => {
  if (Predicate.isUndefined(animation)) return undefined
  const tell = animation.namesSettled
  if (Predicate.isUndefined(tell)) return undefined
  if (Bool.not(hasList(resolution))) return undefined
  const definition = definitionOf(resolution, previous)
  if (Bool.not(Array.isArray(definition))) return undefined
  return { names: definition as ReadonlyArray<string>, tell }
}

/**
 * A list's names told settled one by one (#297): what each leg's end is told to, legs started in the
 * Retarget's order, and each running leg it carries (#325), by its place in `carriedGroups`.
 */
interface NameSettles {
  readonly leg: () => (end: unknown) => void
  readonly carried: (i: number) => (end: unknown) => void
}

/**
 * A list's names, each told settled with the last leg of the keys it drives (#297): its layer's group,
 * or every leg's when the keys aren't split, the running legs the Retarget carries among them (#325).
 * A name that drives none is told at once.
 */
const nameSettlesOf = (
  names: ReadonlyArray<string>,
  resolution: Resolution,
  groups: ReadonlyArray<ReadonlySet<string>> | undefined,
  legGroups: ReadonlyArray<number> | undefined,
  legCount: number,
  carriedGroups: ReadonlyArray<ReadonlyArray<number>>,
  tell: (names: ReadonlyArray<string>) => void,
): NameSettles => {
  const groupOf = (name: string): number => {
    if (Predicate.isUndefined(groups)) return 0
    return Option.getOrElse(Arr.findFirstIndex(resolution.layers, (layer) => layer.name === name), () => 0)
  }
  // The legs still running in each group.
  const left = new Map<number, number>()
  const add = (g: number): void => {
    left.set(g, Option.getOrElse(Option.fromUndefinedOr(left.get(g)), () => 0) + 1)
  }
  UndefinedOr.match(legGroups, {
    onUndefined: () => {
      if (legCount > 0) left.set(0, legCount)
    },
    onDefined: (tags) => Arr.forEach(tags, add),
  })
  Arr.forEach(carriedGroups, (gs) => Arr.forEach(gs, add))
  const running = (name: string): boolean => left.has(groupOf(name))
  let pending = Arr.filter(names, running)
  const idle = Arr.filter(names, (name) => Bool.not(running(name)))
  if (idle.length > 0) tell(idle)
  // A leg in group `g` ended: the names of that group are told once its last has.
  const endIn = (g: number): void => {
    const n = Option.getOrElse(Option.fromUndefinedOr(left.get(g)), () => 1) - 1
    if (n > 0) {
      left.set(g, n)
      return
    }
    left.delete(g)
    const done = Arr.filter(pending, (name) => groupOf(name) === g)
    pending = Arr.filter(pending, (name) => groupOf(name) !== g)
    if (done.length > 0) tell(done)
  }
  let next = 0
  return {
    leg: () => {
      const g = UndefinedOr.match(legGroups, { onUndefined: () => 0, onDefined: (tags) => Option.getOrElse(Option.fromUndefinedOr(tags[next]), () => 0) })
      next++
      return (end) => {
        // A Superseded leg (#200) settles nothing: the next Retarget's tells.
        if (Supersede.isSuperseded(end)) return
        endIn(g)
      }
    },
    carried: (i) => (end) => {
      if (Supersede.isSuperseded(end)) return
      Arr.forEach(UndefinedOr.match(carriedGroups[i], { onUndefined: (): ReadonlyArray<number> => [], onDefined: identity }), endIn)
    },
  }
}

/**
 * Solid 1's animation callbacks (#257, Motion's props): each Retarget's start and settle told to the
 * config's `onAnimationStart` / `onAnimationComplete`, with its `definition`, as the Retarget read
 * the config. A callback that throws is reported, and the element animates on. The Solid 2 binding's
 * config has neither: it hands the same facts over as async values.
 */
export const animationCallbacks = (runtime: WardicRuntime, id: string): AnimationHooks => {
  // Per Retarget, per element: the callback looked up first, and nothing made without one.
  const tell = (name: "onAnimationStart" | "onAnimationComplete", callback: (definition: WardicAnimationDefinition) => void, definition: WardicAnimationDefinition): void => {
    try {
      callback(definition)
    } catch (defect) {
      runtime.runFork(Report.failure(`wardic.spine: ${name} failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ id })))
    }
  }
  return {
    // A list starts as each of its names, in order (#297, Motion's `animateVisualElement` a name).
    started: (resolution, previous, config) => {
      const callback = config.onAnimationStart
      if (Predicate.isUndefined(callback)) return
      const definition = definitionOf(resolution, previous)
      if (Array.isArray(definition)) {
        Arr.forEach(definition as ReadonlyArray<string>, (name) => tell("onAnimationStart", callback, name))
        return
      }
      tell("onAnimationStart", callback, definition)
    },
    // A list's names were each told as they settled (`namesSettled`).
    settled: (resolution, previous, config) => {
      const callback = config.onAnimationComplete
      if (Predicate.isUndefined(callback)) return
      const definition = definitionOf(resolution, previous)
      if (Array.isArray(definition)) return
      tell("onAnimationComplete", callback, definition)
    },
    namesSettled: (names, config) => {
      const callback = config.onAnimationComplete
      if (Predicate.isUndefined(callback)) return
      Arr.forEach(names, (name) => tell("onAnimationComplete", callback, name))
    },
  }
}

/** Which layers of the Override stack are active now, as the binding reads them. */
export interface Active {
  /** In view (#273): `whileInView` applies. */
  readonly inView: boolean
  /** Focused, as the Environment shows it (`:focus-visible`, #273): `whileFocus` applies. */
  readonly focused: boolean
  readonly hovered: boolean
  readonly pressed: boolean
  /** A drag, or a **Keyboard reorder**'s lift (ADR-0037): `whileDrag` applies. */
  readonly dragged: boolean
  /** A drag: the translate keys are the drag's (ADR-0004). */
  readonly dragging: boolean
}

/**
 * The Override stack resolved (ascending priority, Motion's `variantPriorityOrder`): base (animate, or
 * initial when no animate) -> whileInView -> whileFocus -> whileHover -> whileTap -> whileDrag (#273
 * added the first two). `Override.resolve` picks the last active entry per key. Pure:
 * a binding computes it in a memo, so a config change, an inherited variant name's
 * (`parent.variant()`, read only when there's no `animate`) or a layer's drives a Retarget.
 */
export const resolutionOf = (
  c: WardConfig,
  parent: WardicVariantContextValue | undefined,
  initialLink: Values.Values,
  active: Active,
  state: VariantState,
): Resolution => {
  const variants = c.variants
  // Base target resolution priority (ADR-0007):
  //   (1) local `animate` (a Values map or a variant name) — overrides any
  //       inherited variant entirely;
  //   (2) else an INHERITED variant name from the parent context, resolved
  //       against THIS child's OWN `variants` (a child's "open" != its
  //       sibling's "open"); read parent.variant() here so a parent flip
  //       recomputes the memo and retargets;
  //   (3) else the SSR-seeded `initial`.
  const variant = UndefinedOr.match(c.animate, { onDefined: nameOf, onUndefined: () => UndefinedOr.map(parent, (p) => p.variant()) })
  // A list of names (#297, Motion's `VariantLabels`): a base layer a name, in order, so the last name
  // that sets a key drives it. A single name or a values map takes the path below, as before.
  if (Bool.or(Array.isArray(c.animate), Bool.and(Predicate.isUndefined(c.animate), Array.isArray(variant)))) {
    const targets = resolveTargets(variant as ReadonlyArray<string>, variants, c.custom, state)
    const merged = mergedOf(targets)
    const listLayers: Array<Layer> = Arr.map(targets, namedLayerOf)
    return withGestures(c, parent, listLayers, merged.values, variant, active, merged.transition, state)
  }
  // A dynamic variant resolves with this element's own `custom` (#277), as Motion's each child's.
  const target = UndefinedOr.match(c.animate, {
    onDefined: (own) => resolveTarget(own, variants, c.custom, state),
    onUndefined: (): Target =>
      UndefinedOr.match(variant, {
        onDefined: (inheritedName) => resolveTarget(inheritedName, variants, c.custom, state),
        onUndefined: (): Target => ({ values: initialLink, transition: undefined }),
      }),
  })
  const base = target.values
  const baseLayer: Layer = { active: true, values: base, transition: target.transition, name: variant as string | undefined }
  // A Variant child's gestures are on while its provider's are (#291, Motion's `setActive`), each on
  // its own `while*`, else the label the provider hands down. With no provider, its own: nothing made.
  // The common case: nothing handed down and no gesture on. The base layer alone, and nothing else
  // made or called, at every element's mount and Retarget.
  if (Bool.and(handDownFrom(parent) === NO_HAND_DOWN, Bool.not(anyOn(active)))) {
    const alone: ReadonlyArray<Layer> = [baseLayer]
    return { resolved: Override.resolve(alone), base, dragging: active.dragging, variant, active, transition: target.transition, layers: alone, names: NO_GESTURE_NAMES }
  }
  return withGestures(c, parent, [baseLayer], base, variant, active, target.transition, state)
}

/**
 * A resolution from its base layers (one, or one a name of a list, #297) and its gesture layers on
 * top (#291), each gesture's a layer a name too: the Override stack resolved, and the names its
 * active gestures resolved.
 */
const withGestures = (
  c: WardConfig,
  parent: WardicVariantContextValue | undefined,
  layers: Array<Layer>,
  base: Values.Values,
  variant: WardicVariantLabels | undefined,
  active: Active,
  transition: WardicVariantTransition | undefined,
  state: VariantState,
): Resolution => {
  const variants = c.variants
  const above = handDownFrom(parent)
  if (Bool.and(above === NO_HAND_DOWN, Bool.not(anyOn(active)))) {
    return { resolved: Override.resolve(layers), base, dragging: active.dragging, variant, active, transition, layers, names: NO_GESTURE_NAMES }
  }
  const on = gesturesOnOf(active, above)
  const labels = above.names
  gestureLayersInto(layers, c.whileInView, on.inView, labels.inView, variants, c.custom, state)
  gestureLayersInto(layers, c.whileFocus, on.focused, labels.focused, variants, c.custom, state)
  gestureLayersInto(layers, c.whileHover, on.hovered, labels.hovered, variants, c.custom, state)
  gestureLayersInto(layers, c.whileTap, on.pressed, labels.pressed, variants, c.custom, state)
  // whileDrag sits ABOVE tap (highest priority) — driven by the spring,
  // NOT stripped, so e.g. `scale: 1.1` animates while held and returns
  // after release.
  gestureLayersInto(layers, c.whileDrag, on.dragged, labels.dragged, variants, c.custom, state)
  const resolved = Override.resolve(layers)
  const names = activeNamesFor(c, on, labels)
  return { resolved, base, dragging: active.dragging, variant, active, transition, layers, names }
}

/** The values an element starts from, read once at setup (ADR-0003, #134). */
export interface Start {
  /** Its Starting style's values: its `initial` (own or inherited, #50), or its `animate` when it starts there. */
  readonly initialValues: Values.Values
  /** Its `initial` link in the Base-value chain and its fallback base layer: none when it started at `animate`. */
  readonly initialLink: Values.Values
  /** When it started at `animate`, those values, which come after `style` (Motion's `baseTarget`, ADR-0022). */
  readonly startedLink: Values.Values
}

/**
 * An element's {@link Start}, from its config read once and the context it inherits from. With
 * `initial={false}` (its own, inherited, or an `<AnimatePresence initial={false}>`'s first render)
 * it starts at its `animate`, and nothing animates at mount (#134).
 */
export const startOf = (
  config: WardConfig,
  parent: WardicVariantContextValue | undefined,
  presenceBlocks: boolean,
  untrack: Reactivity["untrack"],
): Start => {
  const startedAtAnimate = startsAtAnimate(config, parent, presenceBlocks)
  const initialValues = startingValuesOf(config, parent, presenceBlocks, untrack)
  return {
    initialValues,
    initialLink: Bool.match(startedAtAnimate, { onTrue: () => ({}), onFalse: () => initialValues }),
    startedLink: Bool.match(startedAtAnimate, { onTrue: () => initialValues, onFalse: () => ({}) }),
  }
}

/**
 * The Snapshot: each key's last emitted value, a number or a string, and the numeric velocities.
 * A Retarget starts each key from where it is, with momentum carried across the seam (ADR-0005,
 * ADR-0024). Plain, not reactive; a drag writes its `x`/`y` into it too (ADR-0004).
 */
export interface Snapshot {
  values: Values.Values
  velocities: Record<string, number>
}

/** A Snapshot seeded from the Starting values, velocities 0, so frame 1 flows out of the seed (no snap). */
export const snapshotOf = (start: Start): Snapshot => ({ values: { ...start.initialValues }, velocities: {} })

/**
 * The transition a Retarget runs on (#66): the element's last one when the new one has the same
 * fields, so core's decode cache hits when the object is rebuilt with the same values (a staggered
 * child's, ADR-0007, or one Solid rebuilds as it reads a signal). One per element.
 */
export const makeReuse = (): ((transition: WardicTransition) => WardicTransition) => {
  let lastTransition: WardicTransition | undefined
  return (transition) =>
    Option.fromUndefinedOr(lastTransition).pipe(
      Option.filter((last) => sameFields(last, transition)),
      Option.getOrElse(() => {
        lastTransition = transition
        return transition
      }),
    )
}

/**
 * A mounted element's Base-value links (ADR-0022): a key with no value starts from its `style`
 * value, else its Own value. The Own value is read from the element once per key, at first need
 * (D3): after mount, so never on a server (ADR-0021). Each link is coerced to the shape of the
 * key's target (`like`). `styleNow` reads the user's style untracked; a Live value in it is read now.
 */
export const startLinksOf = (element: HTMLElement, styleNow: (() => object | string | undefined) | undefined, live: LiveStyle | undefined) => {
  const ownValue = OwnValues.of(element)
  // A `style` value read now: a Live value's current value (#130), anything else as it is.
  const readStyle = (raw: unknown): unknown => {
    if (Predicate.isUndefined(live)) return raw
    return live.read(raw)
  }
  const linksFor = (like: number | string) => ({
    style: (key: string) =>
      Option.flatMap(Option.fromUndefinedOr(styleNow), (now) =>
        Option.flatMap(OwnValues.styleValueOf(now(), key), (raw) => OwnValues.valueLike(readStyle(raw), like)),
      ),
    own: (key: string) => Option.flatMap(ownValue(key), (raw) => OwnValues.valueLike(raw, like)),
  })
  const startLinkOf = (key: string, like: number | string) => BaseValue.start(key, linksFor(like))
  return { ownValue, linksFor, startLinkOf }
}

/** {@link startLinksOf}'s links. */
export type StartLinks = ReturnType<typeof startLinksOf>

/**
 * An element's presence record (ADR-0007 exit): seeded with its Starting values, so an exit that
 * fires before any frame still has a `from`, and its `exit` ref, which the ward keeps current. An exit key with no value starts
 * from its Base value's start links (ADR-0022), read from the retained node at the exit.
 */
export const presenceRecordOf = (
  element: HTMLElement,
  start: Start,
  exitOf: (custom: unknown, inherited: WardicVariantLabels | undefined) => ExitTarget,
  links: StartLinks,
  tree: PresenceTree,
  snapshot: Snapshot,
): PresenceRecord => ({
  element,
  snapshot: { current: { ...start.initialValues } },
  exitOf,
  tree,
  startOf: (key, like) => Option.getOrUndefined(Option.map(links.startLinkOf(key, like), (s) => s.value)),
  // Its spine's, read when a child back under its key takes over from it (#286).
  velocities: () => snapshot.velocities,
})

/**
 * Merge an emitted frame's value-map into a presence record's snapshot (nothing without one). It
 * mirrors what the gate accumulates, so an exit departs from the element's actual resting value-map.
 */
export const recordFrameOf = (presence: PresenceRecord | undefined): ((value: Values.Values) => void) => (value) => {
  if (Predicate.isNotUndefined(presence)) Object.assign(presence.snapshot.current, value)
}

/** What {@link makeElementSpine} reads. */
export interface ElementSpineOptions {
  /** The provider runtime the legs fork on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate.Shape
  /** The element's gate id. */
  readonly id: string
  /** The mounted element. */
  readonly element: HTMLElement
  /** Its tag, for a Handoff's check (SVG's routing): `undefined` when it isn't known. */
  readonly tag: string | undefined
  /** Its config now, read where the binding doesn't track. */
  readonly config: () => WardConfig
  /** The variant context it inherits names and its default transition from (`variant-tree.ts`). */
  readonly parent: WardicVariantContextValue | undefined
  /** Whether a Retarget may start now (ADR-0007 `when`); omitted, always. */
  readonly canStart: (() => boolean) | undefined
  /** Its stagger delay in seconds, read at each Retarget (ADR-0007); omitted, none. */
  readonly extraDelay: ((name: string | undefined) => number) | undefined
  /** Told every frame whether it has settled (ADR-0007 orchestration). */
  readonly onFrame: ((done: boolean) => void) | undefined
  /** Whether reduced motion applies (ADR-0029), read at each Retarget. */
  readonly reducedMotion: () => boolean
  /** Which keys reduced motion Snaps (ADR-0036). */
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly start: Start
  readonly snapshot: Snapshot
  readonly reuse: (transition: WardicTransition) => WardicTransition
  readonly links: StartLinks
  /** The user's style now, read untracked: a key's `style` link (ADR-0022). */
  readonly styleNow: (() => object | string | undefined) | undefined
  /** Its routed `style` keys (#130, ADR-0043). */
  readonly live: LiveStyle | undefined
  /** Its presence record, under an `<AnimatePresence>`. */
  readonly presence: PresenceRecord | undefined
  /** Whether a projection node owns its translate keys (ADR-0016). */
  readonly projected: boolean
  /** Its drag axis, `undefined` without a drag (ADR-0004). */
  readonly dragAxis: boolean | "x" | "y" | undefined
  /** Its drag track, whose release a Retarget may take `x`/`y` from (#340); omitted, the drag holds them while `dragging`. */
  readonly drag?: DragTrack | undefined
  /** Its Appear animation, while hydrating (#48, ADR-0044 decision 6). */
  readonly handoff: Handoff | undefined
  /** Told each Retarget's start and settle (#257); omitted, nothing is told. */
  readonly animation?: AnimationHooks | undefined
  /**
   * A list's names orchestrated each on their own (#297's PR 2): a name's keys start once its gate
   * opens, and its starts and settles are told. Omitted for an element that joins nothing and
   * provides nothing.
   */
  readonly byName?: NameOrchestration | undefined
}

/** What the follower reads of the element's Override stack and drag, untracked. */
export interface FollowNow {
  readonly resolved: () => Values.Values
  readonly dragging: () => boolean
}

/** A mounted element's spine. */
export interface ElementSpine {
  /** A Retarget toward `resolution`: called by the binding on each change of its target, untracked. */
  readonly retarget: (resolution: Resolution) => void
  /** Follow the element's Live values in `style` (#130), from its first routed key on. */
  readonly follow: (now: FollowNow) => void
  /** The element's teardown: following stops, and the legs end. */
  readonly dispose: () => void
  /**
   * Start where a leaver is drawn (#286, ADR-0048), before the first Retarget: each key's value and
   * velocity, drawn now. A key no layer sets returns to its Base value from there, as one a Retarget
   * drove does.
   */
  readonly seed: (from: PresenceSeed) => void
}

/**
 * A mounted element's spine: its Retarget, the returns to its Base values, the follower of its
 * Live values, and its legs' lifetime. Every leg runs in the element's FiberSet (#76) and joins its
 * Retarget's token: a Retarget ends the token before it starts its own legs, and {@link
 * ElementSpine.dispose} ends it and closes its Scope. Both end the legs in the calling task: each
 * leg's run leaves the loop at once, and its fiber ends Superseded, inline (ADR-0027, decision 5,
 * *Amendment (#200)*). A leg the token didn't reach is interrupted, by the FiberSet's clear or the
 * Scope's close. The same shape as the projection system's end-of-task holds.
 */
export const makeElementSpine = (options: ElementSpineOptions): ElementSpine => {
  const { animation, byName, canStart, config, element, extraDelay, gate, id, links, live, onFrame, parent, positionalKeys, presence, projected, runtime, snapshot, start, styleNow, tag } = options
  const { initialLink, initialValues, startedLink } = start
  const { linksFor, ownValue, startLinkOf } = links
  let handoff = options.handoff
  // Its Variable values (#55, ADR-0035 *Amendment (#55)*): the Key rule bound to this element,
  // added to each leg it starts, so a `var()` end blends what it resolves to here.
  const elementRules = [Variables.values(element)]
  const recordFrame = recordFrameOf(presence)

  // A routed key a return handed back: written by the follower from now on (#130). Set by
  // `follow`; a return settles a tick after it runs at the earliest.
  let handBack: (key: string) => void = constVoid

  // The keys a Retarget drove, each with its last target value (its shape), and the
  // ones returning to their Base value until that return settles (ADR-0022). Both are
  // the spine's: a Retarget mid-return carries them again, so a return is never
  // frozen half-way, and a key that settled has left them, so a Retarget of the same
  // target (a `when` gate reopening, ADR-0007) leaves it be. The translate keys never
  // return on a projected element (the projection owns them, ADR-0016). On a drag
  // element, the keys the drag moves leave the return while it runs, so they stay where
  // it dropped them (C9) until a layer sets them again.
  const driven = new Map<string, number | string>()
  let returning = new Map<string, BaseValue.BaseSource>()
  const dragMoves: ReadonlyArray<string> = Bool.match(projected, {
    onTrue: (): ReadonlyArray<string> => [],
    onFalse: () => UndefinedOr.match(options.dragAxis, { onUndefined: (): ReadonlyArray<string> => [], onDefined: dragMovesOf }),
  })

  // A Retarget's returns have settled (ADR-0022, D4). A key back at its `style` value is
  // handed back to the element's style, so a later style change shows at rest and the
  // next gesture starts from it; any other key rests inline at its Base value and leaves
  // the target. A key a later Retarget took over is left alone. A routed key (#130) stays
  // in the gate, handed to the follower, which writes its value from now on.
  const settleReturns = (returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): void => {
    // The returns still this Retarget's: a later one took over the rest.
    const settled = Arr.filter(returns, ([key, source]) => returning.get(key) === source)
    Arr.forEach(settled, ([key]) => {
      returning.delete(key)
      driven.delete(key)
      owners.set(key, undefined)
    })
    const toStyle = Arr.map(Arr.filter(settled, ([, source]) => source === "style"), ([key]) => key)
    const routedNow = (key: string): boolean => UndefinedOr.match(live, { onUndefined: constFalse, onDefined: (routes) => routes.routes(key) })
    Arr.forEach(Arr.filter(toStyle, routedNow), (key) => handBack(key))
    const handedBack = Arr.filter(toStyle, Predicate.not(routedNow))
    if (Arr.isReadonlyArrayEmpty(handedBack)) return
    // The gate writes the user's current value back, as the element's `style` would
    // (ADR-0034). A key gone from the user's style by now is cleared, not restored stale.
    const restore = UndefinedOr.map(styleNow, (now) => {
      const style = now()
      return Object.fromEntries(
        Arr.map(handedBack, (key) => [key, Option.match(OwnValues.styleValueOf(style, key), { onNone: () => "", onSome: (value) => String(value) })]),
      ) as Record<string, string>
    })
    gate.release(id, handedBack, restore)
    Arr.forEach(handedBack, (key) => {
      delete snapshot.values[key]
      delete snapshot.velocities[key]
      if (Predicate.isNotUndefined(presence)) delete presence.snapshot.current[key]
    })
  }

  // Cold path: once per Retarget that started a key from its Base value or returned one,
  // run at the head of that Retarget's first leg (no fiber of its own: forking one per
  // element cost 10-20 µs each at a 1000-element mount).
  const baseLog = (started: Record<string, string>, returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): Effect.Effect<void> =>
    Effect.logDebug("wardic.base: a key with no value started from, or returned to, its Base value (ADR-0022)").pipe(
      Effect.annotateLogs({ id, started, returned: Object.fromEntries(returns) }),
    )

  const legScope = Scope.makeUnsafe()
  const legFibers = runtime.runSync(FiberSet.make<void, never>().pipe(Scope.provide(legScope)))
  // Each key's leg (#325, Motion's per-key rule): the running leg that draws it, or the last one that
  // did, landed. A Retarget leaves a key its running leg when it resolves it to the same target, starts
  // none for a key whose last leg landed there, and starts every other key afresh. Each leg has its
  // own token (#200, ADR-0027 *Amendment (#200)*), ended once it has no key left: Superseded, not
  // interrupted, so off the loop at once and its fiber ended normally, at about a sixth of an
  // interrupt's cost.
  const owners: Owners = new Map()
  // The legs that gave up a key in this Retarget: what each still draws is worked out at its end.
  const losing: Array<Running> = []
  // The landing every running leg counts toward: the last Retarget's.
  let current: Landing | undefined
  // A gated Retarget's (ADR-0007 `when`, #325): made at the first.
  let gated: Landing | undefined
  // The variant name the last started Retarget resolved, for its successor's `definition` (#257).
  let lastResolution: Resolution | undefined

  // A leg with no key left ends. Its fiber ends inline (ADR-0027, *Amendment (#200)*); one its token
  // didn't reach, none of its runs on the loop, is interrupted.
  const endLeg = (running: Running): void => {
    Supersede.end(running.supersede)
    const fiber = running.fiber
    if (Predicate.isUndefined(fiber)) return
    if (Predicate.isNotUndefined(fiber.pollUnsafe())) return
    runtime.runFork(Fiber.interrupt(fiber))
  }

  // A leg takes its keys (#325): each key's owner from now on. One callback a spine, not one a leg.
  let owning: Running | undefined
  const ownKey = (key: string): void => {
    owners.set(key, owning)
  }
  const own = (running: Running): void => {
    const keys = Rec.keys(running.targets)
    running.count = keys.length
    owning = running
    Arr.forEach(keys, ownKey)
  }

  // `key`'s leg gives it up: a leg ends with its last key, and draws only the rest before.
  const giveUp = (key: string, running: Running): void => {
    owners.set(key, undefined)
    if (running.done) return
    running.count--
    if (running.count === 0) return endLeg(running)
    if (running.losing) return
    running.losing = true
    losing.push(running)
  }

  // The keys the Retarget being worked out resolves, for `giveUpUnresolved`: one callback a spine,
  // not one a Retarget.
  let resolvedNow: Values.Values = NO_VALUES
  const giveUpUnresolved = (owner: Running | undefined, key: string): void => {
    if (Predicate.isUndefined(owner)) return
    if (Bool.not(Object.hasOwn(resolvedNow, key))) giveUp(key, owner)
  }

  // Each leg that gave up keys draws the ones it kept from now on: once per such leg, a Retarget.
  const keepTheRest = (): void => {
    if (losing.length === 0) return
    Arr.forEach(losing, (running) => {
      running.losing = false
      if (running.count === 0) return
      const kept = Arr.filter(Rec.keys(running.targets), (key) => owners.get(key) === running)
      running.values = keepingOnly(kept)
      running.velocities = keepingOnly(kept)
    })
    losing.length = 0
  }

  // A key's leg ended by a failure (#257 item 4): nothing draws its keys, so a later Retarget starts them afresh.
  const forget = (running: Running): void =>
    Arr.forEach(Rec.keys(running.targets), (key) => {
      if (owners.get(key) === running) owners.set(key, undefined)
    })

  // A gated Retarget (ADR-0007 `when`, #325): a running key it resolves to its leg's target runs on,
  // the element reported unsettled meanwhile, when an earlier change started that leg; every other
  // running key freezes where it is. The change the gate holds may have started legs just before
  // it shut (a child Retargets before its provider's effect resets its `beforeChildren` wait; an
  // `afterChildren` provider starts before its children report): those freeze too, as before.
  const hold = (resolution: Resolution): void => {
    if (Predicate.isUndefined(gated)) gated = gatedLandingOf(onFrame)
    const landing = gated
    const resolved = resolution.resolved
    current = landing
    owners.forEach((running, key) => {
      if (Predicate.isUndefined(running)) return
      if (running.done) return
      if (Bool.every([Object.hasOwn(resolved, key), running.targets[key] === resolved[key], Bool.not(sameResolution(running.resolution, resolution))])) {
        running.landing = landing
        running.names = undefined
        return
      }
      giveUp(key, running)
    })
    keepTheRest()
  }

  // The translate targets of the last Retarget that ran, held or not: what a takeover of the drag's
  // release looks for a change in (#340).
  let lastX: number | string | undefined = undefined
  let lastY: number | string | undefined = undefined
  // A Retarget took `x`/`y` from the release, and the hand-back of `dragging` hasn't come yet.
  let tookRelease = false
  /**
   * Whether the drag holds `x`/`y` for this Retarget (ADR-0004): while its pointer is down and
   * through its release, unless this Retarget gives the release's axis a new target. Then it takes
   * them from the release (#340, ADR-0016 *Amendment (#340)*), as a newer animation of Motion's value
   * stops the one running, and they go on from where the release has them, at its velocity. A key a
   * layer stops setting is no new target: it stays where the drag dropped it (ADR-0022).
   */
  const dragHolds = (resolution: Resolution): boolean => {
    const { x, y } = resolution.resolved
    const newX = Bool.and(Predicate.isNotUndefined(x), x !== lastX)
    const newY = Bool.and(Predicate.isNotUndefined(y), y !== lastY)
    lastX = x
    lastY = y
    if (Bool.not(resolution.dragging)) return false
    // From a takeover to the hand-back of `dragging` at the end of its task, the drag holds nothing.
    if (tookRelease) return false
    return UndefinedOr.match(options.drag, {
      onUndefined: () => true,
      onDefined: (drag) => {
        if (Bool.not(Bool.or(newX, newY))) return true
        tookRelease = drag.takeRelease({ x: newX, y: newY })
        return Bool.not(tookRelease)
      },
    })
  }

  const retarget = (resolution: Resolution): void => {
    const { resolved, base } = resolution

    // `when` start-gate (ADR-0007): when canStart() is false, the keys whose target changed freeze
    // where they are (#325: the rest run on), and the element waits; the binding retargets once
    // the gate flips true.
    if (Predicate.isNotUndefined(canStart) && !canStart()) {
      hold(resolution)
      // Report NOT settled: a gated child sits at its snapshot, still
      // owing an animation, so it must not count as settled (afterChildren).
      if (Predicate.isNotUndefined(onFrame)) onFrame(false)
      return
    }
    // The hand-back of `dragging` after a takeover (#340): the last Retarget already ran with `x`/`y`
    // its own, so one that changes nothing else is no new animation, as Motion's has none. It goes
    // on, and lands and is told as itself.
    if (Bool.and(tookRelease, Bool.not(resolution.dragging))) {
      tookRelease = false
      if (handsBackOnly(resolution, lastResolution)) {
        lastResolution = resolution
        return
      }
    }
    const held = dragHolds(resolution)

    // A key a Retarget drove and no layer sets now returns to its Base value
    // (ADR-0022); with none, it stays where it is (as before #47).
    const t: Values.Values = { ...resolved }
    Arr.forEach(Rec.keys(resolved), (key) => {
      if (Bool.not(projected && TRANSLATE_KEYS.has(key))) driven.set(key, resolved[key])
    })
    if (held) Arr.forEach(dragMoves, (key) => driven.delete(key))
    returning = new Map()
    // Over the Map itself: copying it into an array first costs ~20 times the walk, per element
    // per Retarget (#69's PR 4). Deleting the entry being visited is safe in a Map's iteration.
    Iter.forEach(driven, ([key, like]) => {
      // A translate key the strip below holds back returns once the drag lets go.
      if (Object.hasOwn(resolved, key) || (held && TRANSLATE_KEYS.has(key))) return
      Option.match(BaseValue.of(key, { base, initial: initialLink, started: startedLink, ...linksFor(like) }), {
        onNone: () => {
          driven.delete(key)
        },
        onSome: (r) => {
          t[key] = r.value
          returning.set(key, r.source)
        },
      })
    })
    // MULTI-OWNER strip (ADR-0004): while dragging, x/y are DIRECT-SET by the
    // drag track, so strip the translate keys from the spring's target — the
    // spring must never fight the direct-set. Once dragging is false the
    // keys re-enter normally (post-drag handoff: the spring continues x/y only
    // if `animate` sets them, from the snapshot's rested position).
    if (held) Arr.forEach(TRANSLATE_KEY_LIST, (key) => delete t[key])
    // The keys this Retarget returns; once it lands, a key back at its `style` value is
    // handed back to the element's style (D4) and the rest rest inline.
    const returns = [...returning]
    // The transition, read at Retarget time so a change applies to the next Retarget. A child
    // with no local transition inherits the parent context's (ADR-0007).
    const c = config()

    // This Retarget's landing (#257, #325): it lands when every leg drawing a key it resolves has
    // settled, its own and the ones it carries. A leg's end, told apart (ADR-0027, decision 7): a
    // settle counts; a Superseded end (a Retarget, an unmount, #200) or an interruption (a leg its
    // token didn't reach) is nothing; anything else (a step or a sink that threw, the Frame loop's
    // own failure) is logged and reported (ADR-0030, decision 4), and doesn't count.
    let legs = 0
    // The variant the Retarget before this one resolved, set once this one starts (#257).
    let previous: Resolution | undefined
    const legDone = (): void => {
      if (current !== landing) return
      if (--legs !== 0) return
      settleReturns(returns)
      // The Retarget settled with its last leg (#257): told once the gate has flushed its last frame,
      // so the element shows where it landed.
      if (Predicate.isNotUndefined(animation)) gate.afterFlush(() => animation.settled(resolution, previous, c))
    }
    // A leg's failure (#257 item 4): the Retarget can't land, so a binding waiting on it is told,
    // once, at once: a leg that fails before it writes leaves no flush to wait for. A leg failing
    // as it's built, before `started` is told, is told right after it.
    let failedTold = false
    let startedTold = false
    let failedEarly: { readonly error: unknown } | undefined
    const tellFailed = (error: unknown): void => {
      const hooks = animation as AnimationHooks
      // Called on its hooks, which may be a class's: not taken off them.
      if (Predicate.isNotUndefined(hooks.failed)) hooks.failed(resolution, error)
    }
    const legFailed = (cause: Cause.Cause<unknown>): void => {
      if (Bool.or(failedTold, Predicate.isUndefined(animation))) return
      failedTold = true
      const error = Cause.squash(cause)
      if (startedTold) return tellFailed(error)
      failedEarly = { error }
    }
    // The element settles with its last leg (ADR-0024, D5): a string leg can outlast the
    // numeric one, so each leg's frames report, and only the last leg's settle reports done.
    let reporting = 0
    let settled = 0
    const report = (done: boolean): void => {
      if (done) settled++
      if (Predicate.isNotUndefined(onFrame)) onFrame(settled === reporting)
    }
    const landing: Landing = { report, settled: legDone, failed: legFailed }
    current = landing

    // Per key (#325, Motion's): a key whose running leg heads where this Retarget resolves it runs
    // on, counted toward this landing; one whose last leg landed there stays; every other's leg
    // gives it up, and it starts from its Snapshot value, coerced to its target's shape (ADR-0024,
    // D1). A key with no value yet, or one whose value can't take that shape, starts from its Base
    // value's start links, read here at its first need (ADR-0022, D3); with none, it starts at its
    // target (no motion).
    //
    // Every key's Own value is read first, at its first need, before anything writes it, so a return
    // later finds the element's value, not Wardic's (ADR-0022, D3). The read is kept: a later need is
    // a lookup. A transform key reads nothing.
    let stays: Set<string> | undefined
    let carried: Array<Running> | undefined
    const started: Record<string, string> = {}
    Arr.forEach(Rec.keys(t), (key) => {
      if (Bool.not(Object.hasOwn(initialValues, key))) ownValue(key)
      const like = t[key]
      const owner = owners.get(key)
      if (Predicate.isNotUndefined(owner)) {
        if (owner.targets[key] === like) {
          if (Predicate.isUndefined(stays)) stays = new Set()
          stays.add(key)
          if (Bool.or(owner.done, owner.landing === landing)) return
          owner.landing = landing
          owner.names = undefined
          legs++
          reporting++
          if (Predicate.isUndefined(carried)) carried = []
          carried.push(owner)
          return
        }
        giveUp(key, owner)
      }
      const coerced = OwnValues.valueLike(snapshot.values[key], like)
      if (Option.isSome(coerced)) {
        snapshot.values[key] = coerced.value
        return
      }
      Option.match(Option.filter(startLinkOf(key, like), (s) => isSameKind(s.value, like)), {
        onSome: (s) => {
          snapshot.values[key] = s.value
          started[key] = s.source
        },
        onNone: () => {
          snapshot.values[key] = like
          started[key] = "target"
        },
      })
    })
    // A key no longer resolved (one the drag holds, or one with no Base value) is given up: it stays
    // where it is.
    resolvedNow = t
    owners.forEach(giveUpUnresolved)
    keepTheRest()
    // The keys this Retarget starts legs for: all of them, unless some stay.
    let fresh: Values.Values = t
    if (Predicate.isNotUndefined(stays)) {
      const kept = stays
      fresh = Rec.filter(t, (_, key) => Bool.not(kept.has(key)))
    }
    const from: Values.Values = Rec.map(fresh, (_, key) => UndefinedOr.getOrThrow(snapshot.values[key]))
    // Each leg: the base-value log at the head of the first, and, once the leg's run
    // settles, a count toward this landing, so the per-frame handlers stay as they were.
    let pendingLog = Bool.match(returns.length > 0 || Bool.not(Rec.isEmptyRecord(started)), {
      onTrue: (): Effect.Effect<void> | undefined => baseLog(started, returns),
      onFalse: constUndefined,
    })
    const legEnded = (running: Running) => (exit: Exit.Exit<unknown>): Effect.Effect<void> =>
      Exit.match(exit, {
        // A Superseded leg (#200) counts toward nothing, nor tells a name: the next Retarget's legs
        // land. Nothing made for it: a Retarget ends its element's legs inline.
        onSuccess: (end) => {
          if (Supersede.isSuperseded(end)) return Effect.void
          return Effect.sync(() => {
            running.landing.settled()
            UndefinedOr.map(running.names, (tell) => tell(end))
          })
        },
        // A leg its token didn't reach is interrupted: its keys are given up already, and it isn't a failure.
        onFailure: (cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.void
          return Report.failure("wardic.spine: a leg failed", cause).pipe(
            Effect.annotateLogs({ id }),
            Effect.andThen(Effect.sync(() => {
              forget(running)
              running.landing.failed(cause)
            })),
          )
        },
      })
    // A list's names told settled one by one (#297, Solid 1's callbacks): each as the legs of the keys
    // it drives settle. Made only for a list with a binding that's told so.
    let names: NameSettles | undefined
    const leg = <R,>(running: Running, program: Effect.Effect<unknown, never, R>): Effect.Effect<void, never, R> => {
      legs++
      const log = pendingLog
      pendingLog = undefined
      const run = UndefinedOr.match(log, {
        onUndefined: () => program,
        onDefined: (head) => Effect.andThen(head, program),
      })
      if (Predicate.isNotUndefined(names)) running.names = names.leg()
      return run.pipe(Effect.onExit(legEnded(running)), Effect.asVoid)
    }
    // Start a leg in this element's FiberSet: forked on the provider's runtime, which runs
    // it inline up to its add on the loop, so every leg started in a task is on the loop by
    // the end of that task and takes its first step at the next tick (ADR-0027 decision 5,
    // ADR-0033). Not `FiberSet.run`: forked from
    // a `runSync`, a leg would inherit that call's scheduler (ADR-0027, decision 6).
    // The name the leg being started waits for (#297's PR 2), set as each is started; none for most.
    let gateNow: string | undefined
    const runLeg = <R extends WardicServices>(running: Running, program: Effect.Effect<unknown, never, R>): void => {
      let run: Effect.Effect<unknown, never, R | FrameLoop.FrameLoop> = program
      if (Predicate.isNotUndefined(gateNow)) run = gatedBy(gateNow, byName, running, program)
      const fiber = runtime.runFork(leg(running, run))
      running.fiber = fiber
      FiberSet.addUnsafe(legFibers, fiber)
    }
    const elementTransition = ownOrInherited(c.transition, parent)
    // The base target's own transition (#277): the keys its layer drives animate on it.
    const baseTransition = transitionOfTarget(resolution.transition, elementTransition)
    // Fold the per-child stagger delay (ADR-0007) into the effective
    // transition.delay = base.delay + computedDelay. extraDelay() is read
    // at Retarget time so a re-snapshot before this start is reflected. Each name's keys take that
    // name's delay (#297): the base's, its first name's.
    const layers = resolution.layers
    const extra = extraOf(extraDelay, layers[0])
    const transition = staggeredOf(baseTransition, extra, options.reuse)
    // The legs (#48, ADR-0044 decision 8): one pure builder, which a server render's Appear
    // animation samples too, so the two can't drift. Built here; each leg's machine is built
    // in its own fiber, so a transition core rejects (#66, ADR-0025 *Amendment (#66)*) fails
    // that leg alone, reported as any leg's failure is, while the element's other legs run on.
    // The returns to a moving Live value (#130, ADR-0043 decision 6): a number's follows it,
    // in a leg of its own, and lands on it; the rest return to where it is now. Looked for
    // only when this Retarget returns a key.
    let follow: Follows | undefined
    if (returning.size > 0 && Predicate.isNotUndefined(live)) {
      const routes = live
      follow = { keysOf: (rest) => followingOf(routes, rest, returning), targetOf: (key, start) => liveTargetOf(routes, key, start) }
    }
    const reduce = options.reducedMotion()
    // With a layer's own transition (#277, #291), each key animates on its layer's: the base's keys
    // on the base target's, each active gesture's on its target's, else the element's, as Motion's
    // each animation type runs on its own.
    // A list's names (#297) split them too, each name's at its own delay; a list's returns run on the
    // element's transition, in a group of their own, last.
    // Guards, not matches: per Retarget, per element. A list's work (#297) is done apart, for a list:
    // the Retarget's other calls keep their inlining (docs/agents/effect-first.md).
    const listed = Array.isArray(resolution.variant)
    // A list's names each wait for their own `when` (#297's PR 2): the layers whose gate is shut now.
    let shut: ReadonlyArray<boolean> | undefined
    if (listed) shut = shutOf(layers, byName)
    // Every key the Retarget resolves goes in its layer's group, the ones that stay too (#325): a
    // name's settle waits for them.
    const groups = keysByLayerOf(t, layers, extraDelay, extra, listed, shut)
    const told = namesToldOf(animation, resolution, lastResolution)
    // Every key on one transition when they aren't split, as before; else each group's legs, tagged.
    // A key that stays starts none, and no keys make no leg (#325).
    let retargetLegs: ReadonlyArray<Leg> = NO_LEGS
    let legGroups: ReadonlyArray<number> | undefined
    if (Bool.and(Predicate.isUndefined(groups), hasKeys(fresh))) retargetLegs = legsOf(from, fresh, transition, reduce, positionalKeys, snapshot.velocities, follow)
    if (Predicate.isNotUndefined(groups)) {
      const split = splitLegsOf(fresh, from, groups, resolution, listed, transition, elementTransition, extraDelay, options.reuse, reduce, positionalKeys, snapshot.velocities, follow)
      retargetLegs = split.legs
      legGroups = split.tags
    }
    // The Handoff (#48, ADR-0044 decision 6): the first Retarget that starts picks the Appear
    // animation up as far in as its CSS has got, read at the legs' first tick.
    if (Predicate.isNotUndefined(handoff)) {
      const taken = handoff
      handoff = undefined
      checkHandoff(runtime, id, taken, { tag, from, to: fresh, transition: baseTransition, reduced: reduce, layout: isLayoutNode(c) })
      const at = startAtOf(taken, baseTransition, delayOf(transition))
      retargetLegs = Arr.map(retargetLegs, (one) => startingAt(one, at))
    }
    reporting += retargetLegs.length
    // A list's names (#297): told settled with the legs of the keys each drives, the ones a key that
    // stays carries too (#325), to the binding's callbacks and its orchestration, and each shut
    // one's legs waiting on its gate (PR 2).
    let legGates: ReadonlyArray<string | undefined> | undefined
    if (Bool.or(listed, Predicate.isNotUndefined(told))) {
      const carriedLegs = UndefinedOr.match(carried, { onUndefined: (): ReadonlyArray<Running> => NO_RUNNING, onDefined: identity })
      const listing = listingOf({
        listed,
        told,
        byName,
        resolution,
        groups,
        legGroups,
        legCount: retargetLegs.length,
        carriedGroups: Arr.map(carriedLegs, (running) => groupsOfLeg(running, groups, owners)),
        shut,
        hold: (g) => {
          const kept = pickKeys(from, groups, g)
          if (Bool.not(Rec.isEmptyRecord(kept))) gate.write(id, kept)
        },
        afterFlush: (fn) => gate.afterFlush(fn),
        config: c,
      })
      names = listing.names
      legGates = listing.legGates
      UndefinedOr.map(names, (settles) =>
        Arr.forEach(carriedLegs, (running, i) => {
          running.names = settles.carried(i)
        }))
    }
    // Each leg into its sink, in the builder's order: one dispatcher a Retarget, each sink
    // built for the leg that needs it (#69's PR 2: a Retarget is per element). Each leg draws
    // the keys it animates (#325) until a later Retarget takes them.
    Arr.forEach(retargetLegs, (leg: Leg, i): void => {
      if (Predicate.isNotUndefined(legGates)) gateNow = legGates[i]
      const running = runningOf(leg.to, resolution, landing)
      own(running)
      if (leg._tag === "Follow") {
        const key = leg.key
        const out: Record<string, number> = { [key]: 0 }
        runLeg(
          running,
          Effect.suspend(() =>
            leg.machine().pipe(
              Machine.run((frame) => {
                out[key] = frame.value
                snapshot.values[key] = frame.value
                snapshot.velocities[key] = UndefinedOr.match(frame.velocity, { onUndefined: () => 0, onDefined: identity })
                gate.write(id, out)
                recordFrame(out)
                drew(running, frame.done)
                return undefined
              }, running),
            )),
        )
        return
      }
      if (leg._tag === "Numbers") {
        runLeg(
          running,
          Effect.suspend(() =>
            leg.machine().pipe(
              Machine.run((frame) => {
                // MULTI-OWNER MERGE (ADR-0004): merge the spring's keys into the snapshot
                // rather than replacing it, so the drag's direct-set x/y survive alongside the
                // spring's keys (drag owns x/y, spring owns the rest) and the post-drag
                // handoff continues from the rested position. Only the keys it still draws (#325).
                const value = running.values(frame.value)
                snapshot.values = { ...snapshot.values, ...value }
                snapshot.velocities = { ...snapshot.velocities, ...running.velocities(frame.velocity) }
                gate.write(id, value)
                recordFrame(value)
                drew(running, frame.done)
                return undefined
              }, running),
            )),
        )
        return
      }
      // A snap's or a blend's frames: merged into the Snapshot (ADR-0004), as the spring's are.
      const sink = (frame: Frame.Frame<Values.Values>): undefined => {
        const value = running.values(frame.value)
        snapshot.values = { ...snapshot.values, ...value }
        gate.write(id, value)
        recordFrame(value)
        drew(running, frame.done)
        return undefined
      }
      if (leg._tag === "Snap") {
        // A snapped key comes to rest, so a later spring starts it at rest.
        snapshot.velocities = { ...snapshot.velocities, ...Rec.fromEntries(Arr.map(leg.keys, (key) => [key, 0] as const)) }
        runLeg(running, Effect.suspend(() => leg.machine().pipe(Machine.run(sink, running))))
        return
      }
      runLeg(
        running,
        Effect.suspend(leg.machine).pipe(
          InterpolatorRegistry.withKeyRules(elementRules),
          Effect.flatMap(Machine.run(sink, running)),
        ),
      )
    })
    // The Retarget started, its legs on their way (#257); with none, its own or carried, it landed
    // at once (#325): its returns settle, and the element reports settled at the gate's next flush,
    // after the effects that start its orchestration's wait (ADR-0007).
    previous = lastResolution
    lastResolution = resolution
    const landed = legs === 0
    if (landed) {
      settleReturns(returns)
      UndefinedOr.map(pendingLog, (log) => runtime.runFork(log))
      if (Predicate.isNotUndefined(onFrame)) {
        const tell = onFrame
        gate.afterFlush(() => {
          if (current === landing) tell(true)
        })
      }
    }
    if (Predicate.isNotUndefined(animation)) {
      animation.started(resolution, previous, c)
      startedTold = true
      if (landed) animation.settled(resolution, previous, c)
      UndefinedOr.map(failedEarly, (early) => tellFailed(early.error))
    }
  }

  // --- Live values in `style` (#130, ADR-0043) ------------------------------
  // A routed key (a Live value, or a transform key) is its `style` link, live: while no layer of
  // the Override stack sets it, no return is running to it and no drag moves it, the element
  // follows it, written through the gate on every change. A return hands it back here when it
  // settles (`settleReturns`). The Starting style showed each one's value at render; from mount
  // the gate holds them.
  const follow = (now: FollowNow): void => {
    if (Predicate.isUndefined(live)) return
    const routes = live
    // Built at the first routed key, at mount or later: an element whose `style` routes none builds nothing.
    routes.whenRouted(() => {
      const dragHolds = Bool.and(Bool.not(projected), Predicate.isNotUndefined(options.dragAxis))
      // Whether something other than the follower moves `key` now.
      const owned = (key: string): boolean =>
        Bool.some([
          driven.has(key),
          Object.hasOwn(now.resolved(), key),
          // The drag direct-sets both translate keys while it, and its release, run (ADR-0004).
          Bool.and(dragHolds, Bool.and(now.dragging(), Bool.or(key === "x", key === "y"))),
        ])
      // Written as any frame is: into the gate, the Snapshot (at rest) and the presence record.
      const put = (values: Values.Values): void => {
        Arr.forEach(Rec.keys(values), (key) => {
          snapshot.values[key] = UndefinedOr.getOrThrow(values[key])
          delete snapshot.velocities[key]
        })
        gate.write(id, values)
        recordFrame(values)
      }
      handBack = (key) => {
        Option.match(Option.filter(routes.valueOf(key), isValue), {
          onNone: constVoid,
          onSome: (value) => put({ [key]: value }),
        })
      }
      // Every routed key nothing owns, with, before anything's committed, the values the Override
      // stack's keys start from, so a held start (a `when` gate) keeps showing them.
      const first = Rec.filter(routes.values(), (_, key) => Bool.not(owned(key)))
      if (hasKeys(first)) put({ ...Values.pick(snapshot.values, now.resolved()), ...first })
      return {
        change: (key, value) => {
          if (Bool.or(owned(key), Bool.not(isValue(value)))) return
          put({ [key]: value as number | string })
        },
        removed: (key) => {
          if (owned(key)) return
          delete snapshot.values[key]
          delete snapshot.velocities[key]
          if (Predicate.isNotUndefined(presence)) delete presence.snapshot.current[key]
          // Gone from `style`: the element's own value comes back, or the key's CSS value now.
          const restore = Option.match(OwnValues.styleValueOf(UndefinedOr.match(styleNow, { onUndefined: constUndefined, onDefined: (style) => style() }), key), {
            onNone: () => "",
            onSome: String,
          })
          gate.release(id, [key], { [key]: restore })
        },
      }
    })
  }

  const dispose = (): void => {
    if (Predicate.isNotUndefined(live)) live.stop()
    // The legs end normally first, so closing the Scope has nothing left to interrupt.
    owners.forEach(endUnlessLanded)
    runtime.runFork(Scope.close(legScope, Exit.void))
  }

  // A child back under its key (#286): its values and velocities from where the leaver is drawn, a
  // projected element's translate keys left to its projection (ADR-0016). Drawn at the end of the
  // task, so nothing paints the element at its `initial` first: not in the mount effect it's called
  // in, where the first commit's Starting-style switch would flush Solid 2 inside an effect.
  const seed = (from: PresenceSeed): void => {
    const values = Bool.match(projected, {
      onTrue: () => Rec.filter(from.values, (_, key) => Bool.not(TRANSLATE_KEYS.has(key))),
      onFalse: () => from.values,
    })
    Object.assign(snapshot.values, values)
    snapshot.velocities = { ...snapshot.velocities, ...from.velocities }
    if (Predicate.isNotUndefined(presence)) Object.assign(presence.snapshot.current, values)
    Arr.forEach(Rec.keys(values), (key) => {
      driven.set(key, values[key])
    })
    queueMicrotask(() => gate.flushPass(() => gate.write(id, values)))
  }

  return { retarget, follow, dispose, seed }
}

/**
 * `sink` with an `onCommit` that calls the config's current `onUpdate` (#233), when the config had
 * one at mount; `sink` as it is otherwise. `config` reads it untracked.
 */
export const withOnUpdate = (sink: FlushGate.Sink, atMount: WardConfig["onUpdate"], config: () => WardConfig): FlushGate.Sink => {
  // Per element at mount: most have none, and pay a check.
  if (Predicate.isUndefined(atMount)) return sink
  return {
    ...sink,
    onCommit: (latest) => {
      const onUpdate = config().onUpdate
      if (Predicate.isNotUndefined(onUpdate)) onUpdate(latest as Readonly<Record<string, number | string>>)
    },
  }
}

/**
 * `sink`, removing the element's Appear animation in its first commit (#48, ADR-0044 decision 6):
 * in the task that writes the engine's first frame, so no paint falls between. Without one, `sink`.
 */
export const releasingAppear = (sink: FlushGate.Sink, handoff: Handoff | undefined, element: HTMLElement): FlushGate.Sink => {
  if (Predicate.isUndefined(handoff)) return sink
  const before = sink.beforeFirstCommit
  return {
    ...sink,
    beforeFirstCommit: () => {
      Appear.release(element)
      if (Predicate.isNotUndefined(before)) before()
    },
  }
}

/**
 * A Handoff whose Appear animation the server sampled from another mount animation than the
 * client's: the app rendered differently on the server, or a function it gave has no easing name.
 * Noted once (cold path, `wardic.hydration`); the client's own animation goes on from the same time.
 */
const checkHandoff = (runtime: WardicRuntime, id: string, handoff: Handoff, mount: MountAnimation): void => {
  const same = Option.exists(keyOf(mount), (key) =>
    Appear.matches(handoff.animation, { key, tag: mount.tag, infinite: repeatsForever(mount.transition), projected: mount.layout }))
  if (same) return
  runtime.runFork(
    Effect.logDebug("wardic.hydration: the server's Appear animation was sampled from another mount animation than this element's; it goes on from the same time").pipe(
      Effect.annotateLogs({ id }),
    ),
  )
}

/** The keys a Retarget returns to a Live value that's a number: each one's return follows it (#130). */
const followingOf = (routes: LiveStyle, rest: Values.Values, returning: ReadonlyMap<string, BaseValue.BaseSource>): ReadonlyArray<string> =>
  Arr.filter(Rec.keys(rest), (key) => Bool.and(returning.get(key) === "style", Bool.and(routes.isLive(key), Predicate.isNumber(rest[key]))))

/** Where `key`'s Live value is now, a number; where it last was when it's none (#130). */
const liveTargetOf = (routes: LiveStyle, key: string, start: number): (() => number) => {
  let last = start
  return () => {
    const now = Option.flatMap(routes.valueOf(key), (raw) => OwnValues.valueLike(raw, last))
    if (Option.isSome(now)) last = now.value as number
    return last
  }
}

/** Whether a value is one an element can take: a number or a string. */
const isValue = (value: unknown): value is number | string => Bool.or(Predicate.isNumber(value), Predicate.isString(value))

/**
 * Where `key` rests outside the gate (#130): its `initial`, else its `style` value (a Live value's
 * now), else a transform key's identity, else `undefined`.
 */
export const restingOf = (key: string, initial: Values.Values, style: object | string | undefined, read: (value: unknown) => unknown): unknown =>
  Option.getOrUndefined(
    Option.fromUndefinedOr(initial[key]).pipe(
      Option.orElse((): Option.Option<unknown> => Option.flatMap(OwnValues.styleValueOf(style, key), (raw) => Option.fromNullishOr(read(raw)))),
      Option.orElse((): Option.Option<unknown> => BaseValue.transformIdentity(key)),
    ),
  )

/** A provider runtime's `AtomRegistry`, read on first need: an element with no Atom never reads it. */
export const registryOf = (runtime: WardicRuntime): (() => AtomRegistry.AtomRegistry) => {
  let registry: AtomRegistry.AtomRegistry | undefined
  return () => {
    if (Predicate.isUndefined(registry)) registry = runtime.runSync(AtomRegistry.AtomRegistry)
    return registry
  }
}

/** Log, once per element, that a `transform` string gave way to the transform keys in its `style` (#130). */
export const warnDroppedTransform = (runtime: WardicRuntime, id: string): void => {
  runtime.runFork(
    Effect.logWarning(
      "wardic.style: a `transform` string is dropped while `style` sets a transform key (x, scale, rotate…); " +
        "the keys win, as Motion's do. Give the transform as keys, or drop them",
    ).pipe(Effect.annotateLogs({ id })),
  )
}

/**
 * Log, at debug level, the keys whose Starting style the Environment's Renderer projects
 * differently from the DOM's `project`, which rendered the server markup. Hydration keeps
 * the server's values (the Hydration hold); the Renderer's take over at the first frame.
 * Hydration only, once per element. Internal.
 */
export const flagStartingStyle = (runtime: WardicRuntime, id: string, server: Renderer.Patch, client: Renderer.Patch): void => {
  const keys = Arr.appendAll(
    Arr.filter(Rec.keys(server), (key) => String(server[key]) !== String(client[key])),
    Arr.filter(Rec.keys(client), (key) => Bool.not(key in server)),
  )
  if (Arr.isReadonlyArrayEmpty(keys)) return
  const pick = (patch: Renderer.Patch) => Object.fromEntries(keys.map((key) => [key, patch[key]]))
  runtime.runFork(
    Effect.logDebug(
      "wardic.hydration: the Environment's Renderer projects the Starting style differently from the DOM's; " +
        "hydration keeps the server's until the first frame, and an element that never animates keeps it",
    ).pipe(
      Effect.annotateLogs({ id, keys, server: pick(server), client: pick(client) }),
    ),
  )
}

/** An element's Appear animation on a server (#48, ADR-0044), as both bindings' server wards and component wraps use it. */
export interface ServerAppearOf {
  /** Its inline `animation`, under the user's style: none when it plays none. */
  readonly style: { readonly animation: string } | undefined
  /** The context its children read: its variant node's, with its Appear group when it leads one. */
  readonly provided: WardicVariantContextValue | undefined
  /** Rules it out once it has rendered: its user style is read when `ward()` is called. */
  readonly veto: (reason: string) => void
  /**
   * Rendered after the shell (#245): in a late chunk, and its root when no late element is around
   * it, which puts the chunk's `<style>` after itself. `state` is the render's.
   */
  readonly late: boolean
  readonly chunkRoot: boolean
  readonly state: ServerAppear | undefined
}

/** No Appear animation: a provider with `appear={false}`. */
const NO_APPEAR_ENTRY = (provided: WardicVariantContextValue | undefined): ServerAppearOf => ({
  style: undefined,
  provided,
  veto: constVoid,
  late: false,
  chunkRoot: false,
  state: undefined,
})

/**
 * An element's entry in the server render's Appear animations (#48, ADR-0044): its starting
 * values, its targets at mount (`animate`, or an inherited variant name against its `variants`),
 * its transition, and its place in its parent's group. `state` is the provider's, `undefined` with
 * `appear={false}`: each binding reads it from its own context.
 */
export const appearEntryOf = (
  state: ServerAppear | undefined,
  c: WardConfig,
  tag: string | undefined,
  initialValues: Values.Values,
  node: ServerVariantNode,
): ServerAppearOf =>
  UndefinedOr.match(state, {
    onUndefined: () => NO_APPEAR_ENTRY(node.provided),
    onDefined: (state) => {
      // The target's own transition (#277) drives its mount animation, and its orchestration.
      const target = serverTargetOf(c, node.inherited)
      const own = Option.getOrUndefined(Option.flatMap(target, (t) => Option.fromUndefinedOr(t.transition)))
      const entered = enterServer(state, {
        appear: c.appear,
        tag,
        initial: initialValues,
        to: Option.map(target, (t) => t.values),
        transition: transitionOfTarget(own, ownOrInherited(c.transition, node.inherited)),
        layout: isLayoutNode(c),
        group: Option.flatMap(Option.fromUndefinedOr(node.inherited), (inherited) => Option.fromUndefinedOr(inherited.appearGroup)),
        leads: hasOwnVariants(c),
        ownTransition: transitionOfTarget(own, c.transition),
      })
      return {
        style: Option.match(entered.animation, { onNone: constUndefined, onSome: (animation) => ({ animation }) }),
        provided: Option.match(entered.group, {
          onNone: () => node.provided,
          onSome: (appearGroup) => UndefinedOr.map(node.provided, (provided): WardicVariantContextValue => ({ ...provided, appearGroup })),
        }),
        veto: entered.veto,
        late: entered.late,
        chunkRoot: entered.chunkRoot,
        state,
      }
    },
  })

/**
 * An element's target at mount on a server: its `animate`, else an inherited variant name resolved
 * against its own `variants`, a dynamic one with its `custom` and no values yet (#277).
 */
export const serverTargetOf = (c: WardConfig, inherited: WardicVariantContextValue | undefined): Option.Option<Target> =>
  UndefinedOr.match(c.animate, {
    onDefined: (own) => Option.some(resolveTarget(own, c.variants, c.custom, NO_VARIANT_STATE)),
    onUndefined: () =>
      Option.map(
        Option.flatMap(Option.fromUndefinedOr(inherited), (context) => Option.fromUndefinedOr(context.variant())),
        (name) => resolveTarget(name, c.variants, c.custom, NO_VARIANT_STATE),
      ),
  })

/**
 * A server's Starting style for an element whose `style` has routed keys (#130): the projected
 * `initial` with their values under it. With none, its Starting style as it was.
 */
export const serverStartingStyle = (
  tag: string | undefined,
  starting: Renderer.Patch,
  initialValues: Values.Values,
  routed: Readonly<Record<string, unknown>>,
  layout: boolean,
  untrack: Reactivity["untrack"],
): Renderer.Patch =>
  Bool.match(Rec.isEmptyRecord(routed), {
    onTrue: () => starting,
    onFalse: () => Style.starting(tag, drawnAtRest({ ...valuesOf(routed, serverRegistryOf, untrack), ...initialValues }, layout)).style,
  })

/** Whether a config makes its element a layout node: `layout` (or a mode), or a `layoutId`. */
export const isLayoutNode = (c: WardConfig): boolean =>
  Bool.or(Bool.and(Predicate.isNotUndefined(c.layout), c.layout !== false), Predicate.isNotUndefined(c.layoutId))

/**
 * The values a layout node's Starting style is drawn from (#245, ADR-0044 *Amendment (#245)*):
 * through its projection at rest, as its first commit draws it, its own `x` and `y` left out (the
 * projection owns translate, ADR-0016). Any other element's, as they are.
 */
export const drawnAtRest = (values: Values.Values, layout: boolean): Readonly<Record<string, unknown>> =>
  Bool.match(layout, { onTrue: () => ({ ...values, [Projection.KEY]: Projection.AT_REST }), onFalse: () => values })

/** What a `<Reorder>` item adds to an element's drag: its gesture's axis, read at each drag's start. */
interface DragInternals {
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
}

/** A plain element's drag internals: none. */
const NO_DRAG_INTERNALS: DragInternals = {}

/**
 * The drag axis a spine runs with: its static `drag` config, else `true` for a
 * `<Reorder>` item (its gesture's axis comes from `dragAxis`), else none.
 */
export const dragAxisOf = (config: WardConfig, internal: DragInternals = NO_DRAG_INTERNALS): boolean | "x" | "y" | undefined =>
  Option.getOrUndefined(
    Option.orElse(Option.filter(Option.fromUndefinedOr(config.drag), (drag) => drag !== false), () =>
      Option.map(Option.fromUndefinedOr(internal.dragAxis), (): true => true)),
  )

/**
 * Set each of a drag element's defaults its inline style doesn't already set, and
 * `draggable="false"` unless it has the attribute (the commit-sink paths, at mount).
 */
export const applyDragDefaults = (element: HTMLElement, defaults: Style.DragDefaults): void => {
  Arr.forEach(Rec.keys(defaults), (key) => {
    if (element.style.getPropertyValue(key) === "") element.style.setProperty(key, UndefinedOr.getOrThrow(defaults[key]))
  })
  if (!element.hasAttribute("draggable")) element.setAttribute("draggable", Style.DRAG_DEFAULT_ATTRIBUTES.draggable)
}
