/**
 * A target resolved (#277, ADR-0048): a values map, or a variant name against an element's
 * `variants`, each a target with its own transition or a dynamic variant, a function of `custom`.
 * Motion's `resolveVariantFromProps` and `resolveTransition`. Shared by every binding's spine, its
 * variant nodes and its Starting style.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: solid's `variant-target.ts`, moved for the spine and the
// variant tree to resolve targets in core.
import type * as Values from "../Values.ts"
import * as Stops from "./Stops.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Config from "./Config.ts"

/**
 * What a dynamic variant reads besides `custom` (#277, Motion's `current` and `velocity`): the
 * element's values now and their velocities, its Snapshot's. Copied only when a resolver is called.
 */
export interface VariantState {
  readonly values: Readonly<Record<string, number | string>>
  readonly velocities: Readonly<Record<string, number>>
  /** The velocities now, worked out when read (#663): a Snapshot's, whose spring legs' aren't in `velocities`. */
  velocitiesNow?(state: VariantState): Readonly<Record<string, number>>
}

/** No values yet: a server render's, and the Starting style's. */
export const NO_VARIANT_STATE: VariantState = { values: {}, velocities: {} }

/**
 * A target resolved (#277): its values, clean for core, its own transition, if it has one, its
 * **Transition end** (#428), the values set once its keys land, if it has one, and its Keyframes (#429).
 */
export interface Target {
  readonly values: Values.Values
  readonly transition: Config.WardicVariantTransition | undefined
  readonly transitionEnd: Values.Values | undefined
  /**
   * Its **Keyframes** (#429): each such key's stops, its value in `values` the last stop it rests at,
   * so the Override stack, a Base value and a Transition end read it as any target's. `undefined` with
   * none.
   */
  readonly keyframes: Keyframes | undefined
  /**
   * A resolver it called that threw, and its variant's name (#979): it resolved to nothing in its place.
   * None when every resolver it called returned.
   */
  readonly failure: Option.Option<VariantFailure>
}

/** A target's **Keyframes** (#429): each such key's stops. */
export type Keyframes = Readonly<Record<string, Stops.Stops>>

/** A variant prop's entry: a target, a name, a list of names (#297), or nothing. */
export type Entry = Config.WardicVariant | Config.WardicVariantLabels | undefined

/**
 * Whether an entry names variants (#297): a name, or a list of names. Not a values map: a list is an
 * object too, so a check for a string alone would take it for one.
 */
export const isLabels = (entry: unknown): entry is Config.WardicVariantLabels => Bool.or(Predicate.isString(entry), Arr.isArray(entry))

/** An entry's names, in order (#297): one for a name, a list's own, none for a values map or nothing. */
export const labelsOf = (entry: unknown): ReadonlyArray<string> => {
  if (Predicate.isString(entry)) return [entry]
  if (Arr.isArray(entry)) return entry as ReadonlyArray<string>
  return NO_LABELS
}

/** No names. */
export const NO_LABELS: ReadonlyArray<string> = []

/**
 * Two entries' names the same (#297, Motion's `shallowCompare`): a name, or a list equal name by name
 * in order, so a fresh list with the same names each render isn't a change. A values map, or nothing,
 * matches only itself.
 */
export const sameLabels = (a: Config.WardicVariantLabels | undefined, b: Config.WardicVariantLabels | undefined): boolean => {
  if (a === b) return true
  if (Bool.or(Bool.not(Arr.isArray(a)), Bool.not(Arr.isArray(b)))) return false
  const x = a as ReadonlyArray<string>
  const y = b as ReadonlyArray<string>
  // #672: core's lint (`BOOL_OPERANDS`), met before the move: the `every` is read only for lists of one length.
  if (x.length !== y.length) return false
  return Arr.every(x, (name, i) => name === y[i])
}

/** A target resolved for one of an entry's names (#297): `name` its name, `undefined` for a values map. */
export interface NamedTarget extends Target {
  readonly name: string | undefined
}

/** What a variant name, a variants entry or a resolver's result can be. */
type Definition = Config.WardicVariant | Config.WardicVariantResolver | string | undefined

/** A state's velocities now (#663): worked out where it can, else as it holds them. Per resolver call. */
const velocitiesOf = (state: VariantState): Readonly<Record<string, number>> =>
  UndefinedOr.match(state.velocitiesNow, { onUndefined: () => state.velocities, onDefined: (now) => now(state) })

/** A resolver's throw, handed on in place of a definition: the one value, its throw in {@link thrown}. */
// #979 (ADR-0074): every resolver runs in `calledOf`, so its throw is caught once, for every binding.
// One value, told apart by identity: every target passes the check, and a property check (`in`, a
// symbol a values map never has) cost a resolution 4–5% in Maglev (bench:solid's mount).
const FAILED: { readonly failed: true } = { failed: true }
type Failed = typeof FAILED

/** What the resolver behind the last {@link FAILED} threw: set by `calledOf` and read by `resolveOne` at once, with no app code between. */
// Module state (#979, bench:solid's mount): one throw at a time, handed from `calledOf` to `resolveOne` in one
// synchronous step and cleared there, so `FAILED` stays one value told apart by identity.
let thrown: unknown = undefined

/** A resolver called with what it reads, as Motion calls it, its throw handed on as {@link FAILED}; anything else as it is. */
// #979, Q4: a bare `try`, measured within 2% of the call alone; `Result.try` cost 21–35% more a call.
const calledOf = (definition: Definition | Failed, custom: unknown, state: VariantState): Definition | Failed => {
  if (Predicate.isFunction(definition)) {
    try {
      return definition(custom, { ...state.values }, { ...velocitiesOf(state) })
    } catch (defect) {
      thrown = defect
      return FAILED
    }
  }
  return definition
}

/** A name looked up in `variants`; anything else as it is. */
const namedOf = (definition: Definition | Failed, variants: Config.WardicVariants | undefined): Definition | Failed => {
  if (Bool.not(Predicate.isString(definition))) return definition
  if (Predicate.isUndefined(variants)) return undefined
  return variants[definition as string]
}

/**
 * Resolve a target (#277): a values map, or a variant name, against `variants`, Motion's
 * `resolveVariantFromProps`. A name's entry is looked up, a resolver is called with `custom` and the
 * element's `state`, and a resolver that returns a name is followed once more. Its values go through
 * `Stops.valuesAt`, so `Override.resolve` and `Values.split` never see an `undefined` value, nor an
 * array: a key's Keyframes (#429) are split off, its value their last stop; its `transition` is split
 * off too.
 */
export const resolveTarget = (entry: Entry, variants: Config.WardicVariants | undefined, custom: unknown, state: VariantState): Target => {
  if (Arr.isArray(entry)) return mergedOf(resolveTargets(entry, variants, custom, state))
  return resolveOne(entry as Config.WardicVariant | string | undefined, variants, custom, state)
}

/**
 * Each of an entry's targets, in order (#297): a list's names each resolved on its own, Motion's
 * `definitionList`; a name or a values map alone. An empty list resolves nothing.
 */
export const resolveTargets = (entry: Entry, variants: Config.WardicVariants | undefined, custom: unknown, state: VariantState): ReadonlyArray<NamedTarget> => {
  if (Arr.isArray(entry)) {
    return Arr.map(entry as ReadonlyArray<string>, (name): NamedTarget => ({ ...resolveOne(name, variants, custom, state), name }))
  }
  const one = entry as Config.WardicVariant | string | undefined
  return [{ ...resolveOne(one, variants, custom, state), name: nameOfEntry(one) }]
}

/** An entry's name: the entry itself, when it's one. */
// Per Retarget, per element (#460, compose once): statements.
const nameOfEntry = (entry: Config.WardicVariant | string | undefined): string | undefined => {
  if (Predicate.isString(entry)) return entry
  return undefined
}

/** The first of two failures: what a merge keeps. */
const firstFailure = (before: Option.Option<VariantFailure>, after: Option.Option<VariantFailure>): Option.Option<VariantFailure> => {
  if (Option.isSome(before)) return before
  return after
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
      onDefined: (own) => UndefinedOr.match(merged.transition, { onUndefined: () => own, onDefined: (before) => ({ ...before, ...own }) as Config.WardicVariantTransition }),
    }),
    transitionEnd: UndefinedOr.match(target.transitionEnd, {
      onUndefined: () => merged.transitionEnd,
      onDefined: (own) => UndefinedOr.match(merged.transitionEnd, { onUndefined: () => own, onDefined: (before) => ({ ...before, ...own }) }),
    }),
    // The first name's whose resolver threw (#979).
    failure: firstFailure(merged.failure, target.failure),
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

/** No failure: one value, as every target that resolves carries it (#979, bench:solid's mount). */
export const NO_FAILURE: Option.Option<VariantFailure> = Option.none()

/** Nothing resolved. */
export const NO_TARGET: Target = { values: {}, transition: undefined, transitionEnd: undefined, keyframes: undefined, failure: NO_FAILURE }

/** One name or values map resolved ({@link resolveTarget}). */
const resolveOne = (entry: Config.WardicVariant | string | undefined, variants: Config.WardicVariants | undefined, custom: unknown, state: VariantState): Target => {
  const definition = calledOf(namedOf(calledOf(namedOf(entry, variants), custom, state), variants), custom, state)
  // A resolver that threw resolves to nothing, carrying what it threw and the name it was reached by (#979).
  if (definition === FAILED) {
    const defect = thrown
    thrown = undefined
    return { ...NO_TARGET, failure: Option.some({ defect, name: nameOfEntry(entry) }) }
  }
  if (Bool.or(Predicate.isUndefined(definition), Bool.or(Predicate.isString(definition), Predicate.isFunction(definition)))) {
    return NO_TARGET
  }
  // Its own transition is an object; a `transition` string stays a value, as it was. Its
  // Transition end (#428) is an object too, which `toValues` leaves out of its values.
  const target = definition as { readonly transition?: unknown; readonly transitionEnd?: unknown }
  const transitionEnd = transitionEndOf(target.transitionEnd)
  // A key's Keyframes (#429) rest at their last stop: its value, beside its stops, both found in one
  // pass over its keys (#452).
  if (Bool.not(Predicate.isObject(target.transition))) {
    const split = Stops.splitValues(target, "last")
    return { values: split.values, transition: undefined, transitionEnd, keyframes: Option.getOrUndefined(split.keyframes), failure: NO_FAILURE }
  }
  const { transition, ...values } = target
  const split = Stops.splitValues(values, "last")
  return { values: split.values, transition: transition as Config.WardicVariantTransition, transitionEnd, keyframes: Option.getOrUndefined(split.keyframes), failure: NO_FAILURE }
}

/** A target's Transition end (#428), clean for core: none for anything but a values map, or an empty one. */
const transitionEndOf = (given: unknown): Values.Values | undefined => {
  if (Bool.not(Predicate.isObject(given))) return undefined
  const values = Stops.toValues(given as object)
  if (Rec.isEmptyRecord(values)) return undefined
  return values
}

/**
 * The transition an animation to a target runs on (#277, Motion's `resolveTransition`): the target's
 * own in place of the element's, or laid over it with `inherit: true` (a shallow merge, its own keys
 * winning); the element's when it has none. An own transition with no `inherit` is handed back as it
 * is, the same object each call, so a memo of it holds (#460: a copy per call made Solid 2's variant
 * node re-run its orchestration's readers at every gesture, `UNSTABLE_MEMO_OUTPUT`).
 */
export const transitionOfTarget = (own: Config.WardicVariantTransition | undefined, element: Config.WardicTransition | undefined): Config.WardicTransition | undefined => {
  if (Predicate.isUndefined(own)) return element
  if (!("inherit" in own)) return own as Config.WardicTransition
  const { inherit, ...rest } = own
  if (inherit === true) return { ...element, ...rest } as Config.WardicTransition
  return rest as Config.WardicTransition
}

/** A target's values, and its failure: what {@link startingVariantsOf} reads of each. */
const valuesOfTarget = (target: Target): Values.Values => target.values
const failureOfTarget = (target: Target): Option.Option<VariantFailure> => target.failure

/** A variant's resolver that threw (#979): what it threw, and the variant's name where it has one. */
export interface VariantFailure {
  readonly defect: unknown
  readonly name: string | undefined
}

/** `variants` as the Starting style reads them, and the first of them whose resolver threw. */
export interface StartingVariants {
  readonly variants: object | undefined
  readonly failure: Option.Option<VariantFailure>
}

/** No variants: one value, as most elements have none (#979, bench:solid's mount). */
const NO_STARTING_VARIANTS: StartingVariants = { variants: undefined, failure: NO_FAILURE }

/**
 * `variants` with each entry resolved to its values, a dynamic one with `custom` and no values yet
 * (#277): what dom's Starting style reads, which takes values maps only. As they are when none is a
 * function. A resolver that throws gives its entry no values, and its throw is the failure.
 */
export const startingVariantsOf = (variants: object | undefined, custom: unknown): StartingVariants => {
  if (Predicate.isUndefined(variants)) return NO_STARTING_VARIANTS
  const entries = variants as Config.WardicVariants
  if (Bool.not(Arr.some(Rec.values(entries), Predicate.isFunction))) return { variants, failure: NO_FAILURE }
  // Once an element's setup (#979): each entry resolved, a throwing resolver's left with no values.
  const targets = Rec.map(entries, (_, name) => resolveTarget(name, entries, custom, NO_VARIANT_STATE))
  return { variants: Rec.map(targets, valuesOfTarget), failure: Option.firstSomeOf(Arr.map(Rec.values(targets), failureOfTarget)) }
}

/** What orchestration's resolution of a variant name, `entry`, came to: its failure, or none once it resolves. */
export type Orchestrated = (entry: Config.WardicVariantLabels, failure: Option.Option<VariantFailure>) => void

/**
 * The own transition of an element's target now (#277): its `animate` map's, else the variant it
 * names or inherits (`name`), resolved with `custom` and no values. What its orchestration reads.
 * `orchestrated` is told what a name's resolution came to: a resolver that throws gives no own
 * transition.
 */
export const ownTransitionOf = (
  animate: object | Config.WardicVariantLabels | undefined,
  name: Config.WardicVariantLabels | undefined,
  variants: object | undefined,
  custom: unknown,
  orchestrated?: Orchestrated,
): Config.WardicVariantTransition | undefined => {
  const byName = variants as Config.WardicVariants | undefined
  if (Bool.and(Predicate.isNotUndefined(animate), Bool.not(isLabels(animate)))) {
    return resolveTarget(animate as Config.WardicVariant, byName, custom, NO_VARIANT_STATE).transition
  }
  if (Predicate.isUndefined(name)) return undefined
  const target = resolveTarget(name, byName, custom, NO_VARIANT_STATE)
  // #979 (Q6): a throw here is reported through the element's own once, its resolution's apart.
  if (Predicate.isNotUndefined(orchestrated)) orchestrated(name, target.failure)
  return target.transition
}
