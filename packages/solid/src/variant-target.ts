/**
 * A target resolved (#277, ADR-0048): a values map, or a variant name against an element's
 * `variants`, each a target with its own transition or a dynamic variant, a function of `custom`.
 * Motion's `resolveVariantFromProps` and `resolveTransition`. Solid-free, shared by both bindings'
 * spines, their variant nodes and the Starting style.
 *
 * @module
 */
import type * as Values from "@wardic/core/Values"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition, WardicVariant, WardicVariantLabels, WardicVariantResolver, WardicVariants, WardicVariantTransition } from "./config.ts"

/**
 * What a dynamic variant reads besides `custom` (#277, Motion's `current` and `velocity`): the
 * element's values now and their velocities, its Snapshot's. Copied only when a resolver is called.
 */
export interface VariantState {
  readonly values: Readonly<Record<string, number | string>>
  readonly velocities: Readonly<Record<string, number>>
}

/** No values yet: a server render's, and the Starting style's. */
export const NO_VARIANT_STATE: VariantState = { values: {}, velocities: {} }

/**
 * A target resolved (#277): its values, clean for core, its own transition, if it has one, its
 * **Transition end** (#428), the values set once its keys land, if it has one, and its Keyframes (#429).
 */
export interface Target {
  readonly values: Values.Values
  readonly transition: WardicVariantTransition | undefined
  readonly transitionEnd: Values.Values | undefined
  /**
   * Its **Keyframes** (#429): each such key's stops, its value in `values` the last stop it rests at,
   * so the Override stack, a Base value and a Transition end read it as any target's. `undefined` with
   * none.
   */
  readonly keyframes: Keyframes | undefined
}

/** A target's **Keyframes** (#429): each such key's stops. */
export type Keyframes = Readonly<Record<string, Style.Stops>>

/** A variant prop's entry: a target, a name, a list of names (#297), or nothing. */
export type Entry = WardicVariant | WardicVariantLabels | undefined

/**
 * Whether an entry names variants (#297): a name, or a list of names. Not a values map: a list is an
 * object too, so a check for a string alone would take it for one.
 */
export const isLabels = (entry: unknown): entry is WardicVariantLabels => Bool.or(Predicate.isString(entry), Array.isArray(entry))

/** An entry's names, in order (#297): one for a name, a list's own, none for a values map or nothing. */
export const labelsOf = (entry: unknown): ReadonlyArray<string> => {
  if (Predicate.isString(entry)) return [entry]
  if (Array.isArray(entry)) return entry as ReadonlyArray<string>
  return NO_LABELS
}

/** No names. */
export const NO_LABELS: ReadonlyArray<string> = []

/**
 * Two entries' names the same (#297, Motion's `shallowCompare`): a name, or a list equal name by name
 * in order, so a fresh list with the same names each render isn't a change. A values map, or nothing,
 * matches only itself.
 */
export const sameLabels = (a: WardicVariantLabels | undefined, b: WardicVariantLabels | undefined): boolean => {
  if (a === b) return true
  if (Bool.or(Bool.not(Array.isArray(a)), Bool.not(Array.isArray(b)))) return false
  const x = a as ReadonlyArray<string>
  const y = b as ReadonlyArray<string>
  return Bool.and(x.length === y.length, Arr.every(x, (name, i) => name === y[i]))
}

/** A target resolved for one of an entry's names (#297): `name` its name, `undefined` for a values map. */
export interface NamedTarget extends Target {
  readonly name: string | undefined
}

/** What a variant name, a variants entry or a resolver's result can be. */
type Definition = WardicVariant | WardicVariantResolver | string | undefined

/** A resolver called with what it reads, as Motion calls it; anything else as it is. */
const calledOf = (definition: Definition, custom: unknown, state: VariantState): Definition => {
  if (Predicate.isFunction(definition)) return definition(custom, { ...state.values }, { ...state.velocities })
  return definition
}

/** A name looked up in `variants`; anything else as it is. */
const namedOf = (definition: Definition, variants: WardicVariants | undefined): Definition => {
  if (Bool.not(Predicate.isString(definition))) return definition
  if (Predicate.isUndefined(variants)) return undefined
  return variants[definition as string]
}

/**
 * Resolve a target (#277): a values map, or a variant name, against `variants`, Motion's
 * `resolveVariantFromProps`. A name's entry is looked up, a resolver is called with `custom` and the
 * element's `state`, and a resolver that returns a name is followed once more. Its values go through
 * `Style.valuesAt`, so `Override.resolve` and `Values.split` never see an `undefined` value, nor an
 * array: a key's Keyframes (#429) are split off, its value their last stop; its `transition` is split
 * off too.
 */
export const resolveTarget = (entry: Entry, variants: WardicVariants | undefined, custom: unknown, state: VariantState): Target => {
  if (Array.isArray(entry)) return mergedOf(resolveTargets(entry, variants, custom, state))
  return resolveOne(entry as WardicVariant | string | undefined, variants, custom, state)
}

/**
 * Each of an entry's targets, in order (#297): a list's names each resolved on its own, Motion's
 * `definitionList`; a name or a values map alone. An empty list resolves nothing.
 */
export const resolveTargets = (entry: Entry, variants: WardicVariants | undefined, custom: unknown, state: VariantState): ReadonlyArray<NamedTarget> => {
  if (Array.isArray(entry)) {
    return Arr.map(entry as ReadonlyArray<string>, (name): NamedTarget => ({ ...resolveOne(name, variants, custom, state), name }))
  }
  const one = entry as WardicVariant | string | undefined
  return [{ ...resolveOne(one, variants, custom, state), name: Bool.match(Predicate.isString(one), { onTrue: () => one as string, onFalse: () => undefined }) }]
}

/**
 * Targets merged in order (#297): their values, a later one's winning a key both set, and their own
 * transitions field by field, a later one's winning. The merged transition is what orchestration
 * reads for a list as a whole (`when` the last name's that sets it); each key's legs run on the own
 * transition of the name that drives it, not on this.
 */
export const mergedOf = (targets: ReadonlyArray<Target>): Target =>
  Arr.reduce(targets, NO_TARGET, (merged, target): Target => ({
    values: { ...merged.values, ...target.values },
    keyframes: keyframesOver(target, merged.keyframes),
    transition: UndefinedOr.match(target.transition, {
      onUndefined: () => merged.transition,
      onDefined: (own) => UndefinedOr.match(merged.transition, { onUndefined: () => own, onDefined: (before) => ({ ...before, ...own }) as WardicVariantTransition }),
    }),
    transitionEnd: UndefinedOr.match(target.transitionEnd, {
      onUndefined: () => merged.transitionEnd,
      onDefined: (own) => UndefinedOr.match(merged.transitionEnd, { onUndefined: () => own, onDefined: (before) => ({ ...before, ...own }) }),
    }),
  }))

/**
 * `target`'s Keyframes over `before` (#429): a later name's own, and `before`'s for the keys it doesn't
 * set, so a key it sets to one value is no longer Keyframes. `undefined` when neither has any.
 */
const keyframesOver = (target: Target, before: Keyframes | undefined): Keyframes | undefined => {
  if (Predicate.isUndefined(before)) return target.keyframes
  const kept = Rec.filter(before, (_, key) => Bool.not(Object.hasOwn(target.values, key)))
  const over: Keyframes = { ...kept, ...target.keyframes }
  return Bool.match(Rec.isEmptyRecord(over), { onTrue: () => undefined, onFalse: () => over })
}

/** Nothing resolved. */
export const NO_TARGET: Target = { values: {}, transition: undefined, transitionEnd: undefined, keyframes: undefined }

/** One name or values map resolved ({@link resolveTarget}). */
const resolveOne = (entry: WardicVariant | string | undefined, variants: WardicVariants | undefined, custom: unknown, state: VariantState): Target => {
  const definition = calledOf(namedOf(calledOf(namedOf(entry, variants), custom, state), variants), custom, state)
  if (Bool.or(Predicate.isUndefined(definition), Bool.or(Predicate.isString(definition), Predicate.isFunction(definition)))) {
    return NO_TARGET
  }
  // Its own transition is an object; a CSS `transition` string stays a value, as it was. Its
  // Transition end (#428) is an object too, which `toValues` leaves out of its values.
  const target = definition as { readonly transition?: unknown; readonly transitionEnd?: unknown }
  const transitionEnd = transitionEndOf(target.transitionEnd)
  // A key's Keyframes (#429) rest at their last stop: its value, beside its stops, both found in one
  // pass over its keys (#452).
  if (Bool.not(Predicate.isObject(target.transition))) {
    const split = Style.splitValues(target, "last")
    return { values: split.values, transition: undefined, transitionEnd, keyframes: split.keyframes }
  }
  const { transition, ...values } = target
  const split = Style.splitValues(values, "last")
  return { values: split.values, transition: transition as WardicVariantTransition, transitionEnd, keyframes: split.keyframes }
}

/** A target's Transition end (#428), clean for core: none for anything but a values map, or an empty one. */
const transitionEndOf = (given: unknown): Values.Values | undefined => {
  if (Bool.not(Predicate.isObject(given))) return undefined
  const values = Style.toValues(given as object)
  if (Rec.isEmptyRecord(values)) return undefined
  return values
}

/**
 * The transition an animation to a target runs on (#277, Motion's `resolveTransition`): the target's
 * own in place of the element's, or laid over it with `inherit: true` (a shallow merge, its own keys
 * winning); the element's when it has none.
 */
export const transitionOfTarget = (own: WardicVariantTransition | undefined, element: WardicTransition | undefined): WardicTransition | undefined => {
  if (Predicate.isUndefined(own)) return element
  const { inherit, ...rest } = own
  if (inherit === true) return { ...element, ...rest } as WardicTransition
  return rest as WardicTransition
}

/**
 * `variants` with each entry resolved to its values, a dynamic one with `custom` and no values yet
 * (#277): what dom's Starting style reads, which takes values maps only. As they are when none is a
 * function.
 */
export const startingVariantsOf = (variants: object | undefined, custom: unknown): object | undefined => {
  if (Predicate.isUndefined(variants)) return undefined
  const entries = variants as WardicVariants
  if (Bool.not(Arr.some(Rec.values(entries), Predicate.isFunction))) return variants
  return Rec.map(entries, (_, name) => resolveTarget(name, entries, custom, NO_VARIANT_STATE).values)
}

/**
 * The own transition of an element's target now (#277): its `animate` map's, else the variant it
 * names or inherits (`name`), resolved with `custom` and no values. What its orchestration reads.
 */
export const ownTransitionOf = (
  animate: object | WardicVariantLabels | undefined,
  name: WardicVariantLabels | undefined,
  variants: object | undefined,
  custom: unknown,
): WardicVariantTransition | undefined => {
  const byName = variants as WardicVariants | undefined
  if (Bool.and(Predicate.isNotUndefined(animate), Bool.not(isLabels(animate)))) {
    return resolveTarget(animate as WardicVariant, byName, custom, NO_VARIANT_STATE).transition
  }
  if (Predicate.isUndefined(name)) return undefined
  return resolveTarget(name, byName, custom, NO_VARIANT_STATE).transition
}
