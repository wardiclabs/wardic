/**
 * What an Imperative animation's call of a Batch turns into, for every Environment: an `animate` call's
 * targets for each member (a number, two stops, or a function of a member's index and the count), each
 * key's transition for the change (its own, its Default transition held by its delay, reduced motion's
 * Snap, `skipAnimations`' landing at once), a `stagger()` counting the members it moves, and a sequence's
 * Segment of the Batch, each member's key through its own stops. An Environment's binding names its
 * members and its errors; this works out the rest over core's `Batch`.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #882 (ADR-0073, *Amendment (#882)*, PR 3): dom's `BatchMembers`, its
// environment-agnostic part moved here, so `@wardic/object`'s Batch runs the DOM's calls; #665's rules
// (ADR-0069, *Amendment (#665)*; ADR-0070, *Amendment (#665)*).
import type * as Batch from "../Batch.ts"
import type * as Machine from "../Machine.ts"
import type * as Playback from "../Playback.ts"
import * as ReducedMotion from "../ReducedMotion.ts"
import type * as Sequence from "../Sequence.ts"
import type * as Config from "./Config.ts"
import type * as Imperative from "./Imperative.ts"
import * as RetargetLegs from "./RetargetLegs.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"

/** How an Environment reports a Batch call's error: it throws, naming what it got. */
export type Fail = (message: string) => never

/** One change that lands every key at once: `skipAnimations`'. */
export const INSTANT: Batch.Transition = { type: "tween", duration: 0 }

/** A sequence's run that lands a key at once after `delay`: `skipAnimations`', and reduced motion's Snap of a positional key. */
// Module state (#460, Q7): a cache built once, keyed by what it caches.
const LANDINGS = new Map<number, Machine.KeyframesOptions>()

/** A run of keyframes that lands at once after `delay`, one object each. */
export const landingAfter = (delay: number): Machine.KeyframesOptions => {
  const known = LANDINGS.get(delay)
  if (Predicate.isNotUndefined(known)) return known
  const made: Machine.KeyframesOptions = { duration: 0, delay }
  LANDINGS.set(delay, made)
  return made
}

/** A Batch key's stop in a sequence, as core's Batch takes it: a number, `NaN` for `null`. */
export const stopNumber = (stop: Sequence.Stop): number => {
  if (Predicate.isNumber(stop)) return stop
  return Number.NaN
}

/** A key's last stop that's a number, `NaN` (where it is) for none: what its `null`s after it hold. */
export const lastNumber = (stops: ReadonlyArray<number>): number =>
  Option.getOrElse(Arr.findLast(stops, (stop) => !Number.isNaN(stop)), () => Number.NaN)

/** Whether `value` is a Batch's key's first stop: a number, or `null` for where it is. */
export const isFirstStop: Predicate.Predicate<unknown> = /*#__PURE__*/ Predicate.or(Predicate.isNumber, Predicate.isNull)

/** Whether `value` is two stops. */
export const isPair = (value: unknown): value is readonly [unknown, unknown] => {
  if (!Arr.isArray(value)) return false
  return value.length === 2
}

/** Whether `value` is a Batch key's value in a sequence: a number, `null`, or stops of them. */
const isSegmentStops = (value: unknown): boolean => {
  if (isFirstStop(value)) return true
  if (!Arr.isArray(value)) return false
  return Arr.every(value, isFirstStop)
}

/** A Batch key's value in a sequence (Q38): a number, `null` or stops of them; else an error naming the key, and the member a function gave it. */
export const segmentValueOf = (key: string, value: unknown, memberName: string | undefined, fail: Fail): Sequence.Stop | ReadonlyArray<Sequence.Stop> => {
  if (isSegmentStops(value)) return value as Sequence.Stop | ReadonlyArray<Sequence.Stop>
  const whose = UndefinedOr.match(memberName, { onUndefined: () => "", onDefined: (name) => `${name}'s ` })
  return fail(`a sequence gives ${whose}"${key}" as ${JSON.stringify(value)}: a Batch's key takes a number, \`null\`, or stops of them`)
}

/** Reduced motion's Snap after `delay`: a 0 s tween, kept by its delay so its keys share one. */
// Module state (#460, Q7): a cache built once, keyed by what it caches.
const SNAPS = new Map<number, Batch.Transition>()

const snapAfter = (delay: number): Batch.Transition => {
  const known = SNAPS.get(delay)
  if (Predicate.isNotUndefined(known)) return known
  const made: Batch.Transition = { type: "tween", duration: 0, delay }
  SNAPS.set(delay, made)
  return made
}

/**
 * A Default transition held by a key's own `delay`, as a Wardic element's is when its transition gives
 * only a delay (ADR-0051): one object for each transition and delay, so the members on it share it.
 */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const DELAYED = new WeakMap<object, Map<number, Batch.Transition>>()

export const delayedBy = (transition: Batch.Transition, delay: number): Batch.Transition => {
  if (delay === 0) return transition
  let byDelay = DELAYED.get(transition)
  if (Predicate.isUndefined(byDelay)) {
    byDelay = new Map()
    DELAYED.set(transition, byDelay)
  }
  const known = byDelay.get(delay)
  if (Predicate.isNotUndefined(known)) return known
  const made = { ...transition, delay } as Batch.Transition
  byDelay.set(delay, made)
  return made
}

/**
 * A transition without a `stagger()` delay, which a change gives each member by its place: one object
 * each. A `delay` in seconds stays, held by the keys the transition's own fields reach, as a Wardic
 * element's top-level delay is.
 */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const UNSTAGGERED = new WeakMap<object, Config.WardicTransition>()

export const unstaggered = (given: { readonly delay?: unknown }): Config.WardicTransition => {
  if (!Predicate.isFunction(given.delay)) return given as Config.WardicTransition
  const known = UNSTAGGERED.get(given)
  if (Predicate.isNotUndefined(known)) return known
  const made = { ...given, delay: undefined } as unknown as Config.WardicTransition
  UNSTAGGERED.set(given, made)
  return made
}

/** A change's `stagger()` delay, for the members it moves; `undefined` for none. */
export const staggerOf = (given: Config.WardicTransition | undefined): ((rank: number, n: number) => number) | undefined => {
  if (Predicate.isUndefined(given)) return undefined
  const delay: unknown = given.delay
  if (Predicate.isFunction(delay)) return delay as (rank: number, n: number) => number
  return undefined
}

/** A key's transition as a Batch runs it: its run, which can't be an inertia or repeat. */
const batchRunOf = (run: RetargetLegs.Run, key: string, fail: Fail): Batch.Transition => {
  if (run.type === "inertia") fail(`"${key}" has an inertia transition, which a Batch can't run: give it a spring or a tween`)
  if (Predicate.hasProperty(run, "repeat")) fail(`"${key}"'s transition repeats, which a Batch can't run`)
  return run as Batch.Transition
}

/** A change's plan for one key: its own transition, or `undefined` for its Default transition held by `delay`. */
export interface KeyPlan {
  readonly own: Batch.Transition | undefined
  readonly delay: number
}

/**
 * Each key's plan for a change, by its index, as a Wardic element's keys run (#301): its entry, else
 * `default`, else the transition's own fields; reduced motion's Snap for a positional key that doesn't
 * opt out; its Default transition, held by its own `delay`, for a key whose transition isn't defined.
 */
// Once a change, per key.
export const plannedOf = (positional: ReducedMotion.PositionalKeys["Service"], keys: ReadonlyArray<string>, given: Config.WardicTransition | undefined, reduced: boolean, fail: Fail): ReadonlyArray<KeyPlan> =>
  Arr.map(keys, (key): KeyPlan => {
    const transition = RetargetLegs.transitionForKey(given, key)
    let delay = 0
    let respects = true
    if (Predicate.isNotUndefined(transition)) {
      if (Predicate.isNumber(transition.delay)) delay = transition.delay
      respects = transition.respectReducedMotion !== false
    }
    if (reduced && respects && positional.isPositional(key)) return { own: snapAfter(delay), delay }
    const run = RetargetLegs.runOf(transition)
    if (Predicate.isUndefined(run)) return { own: undefined, delay }
    return { own: batchRunOf(run, key, fail), delay }
  })

/**
 * A member's transitions on `keys` for a change planned as `planned`: each key's own, else its Default
 * transition (`defaultFor`) toward its target there, `targetAt(k)`; every key at once when it's skipped.
 */
export const memberTransitionsOf = (
  keys: ReadonlyArray<string>,
  planned: ReadonlyArray<KeyPlan>,
  defaultFor: (key: string, target: number) => Batch.Transition,
  targetAt: (k: number) => number,
  skipped: boolean,
): ReadonlyArray<Batch.Transition> =>
  Arr.map(keys, (key, k) => {
    if (skipped) return INSTANT
    const plan = planned[k] as KeyPlan
    if (Predicate.isNotUndefined(plan.own)) return plan.own
    return delayedBy(defaultFor(key, targetAt(k)), plan.delay)
  })

/** What a binding tells these of its Batch: its keys, its Environment's Positional keys and Default transitions, and its errors. */
export interface Planning {
  readonly keys: ReadonlyArray<string>
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  /** A key's Default transition toward `target`, by the key's index. */
  readonly defaultFor: (k: number, target: number) => Batch.Transition
  readonly fail: Fail
}

/** A change's call: its transition, its scope's settings, its Playhead and its landing. */
export interface ChangeCall {
  readonly transition: Config.WardicTransition | undefined
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
  readonly head: Playback.Playhead
  readonly settled: () => void
  /** It ended with a key a later change took, never landing (#951). */
  readonly taken?: (() => void) | undefined
  readonly onMemberLanded?: ((slot: number) => void) | undefined
}

/**
 * A driven change's options for core's `Batch.animate`, toward `targetOf`, from `fromOf`'s first stops
 * when it gives them, on its call's transitions: each key's own, else its Default transition toward the
 * member's target, held by the key's delay; every key at once when the call skips; its `stagger()`
 * counting the members it moves.
 */
export const animateOptions = (
  planning: Planning,
  call: ChangeCall,
  targetOf: (slot: number, k: number) => number,
  fromOf: ((slot: number, k: number) => number) | undefined,
): Batch.AnimateOptions => {
  const transition = Bool.match(call.skipAnimations, {
    onTrue: () => (): Batch.Transition => INSTANT,
    onFalse: () => {
      const planned = plannedOf(planning.positionalKeys, planning.keys, UndefinedOr.map(call.transition, unstaggered), call.reducedMotion, planning.fail)
      return (slot: number, k: number): Batch.Transition => {
        const plan = planned[k] as KeyPlan
        if (Predicate.isNotUndefined(plan.own)) return plan.own
        return delayedBy(planning.defaultFor(k, targetOf(slot, k)), plan.delay)
      }
    },
  })
  const options: { -readonly [K in keyof Batch.AnimateOptions]: Batch.AnimateOptions[K] } = { head: call.head, transition, onLanded: call.settled }
  if (Predicate.isNotUndefined(fromOf)) options.from = fromOf
  if (Predicate.isNotUndefined(call.taken)) options.onTaken = call.taken
  if (Predicate.isNotUndefined(call.onMemberLanded)) options.onMemberLanded = call.onMemberLanded
  const delay = Bool.match(call.skipAnimations, { onTrue: () => undefined, onFalse: () => staggerOf(call.transition) })
  if (Predicate.isNotUndefined(delay)) options.delay = delay
  return options
}

/**
 * How a binding names its members for a call, by the number it passes for each (its slot in the Batch
 * for an `animate` call, the binding's own number for a Segment's): their place in its list, their count,
 * and what an error calls them.
 */
export interface Members {
  /** A member's index in its list: what a function of the index is given. */
  readonly indexOf: (id: number) => number
  /** How many members the Batch has: what a function of the index is given as the count. */
  readonly count: () => number
  /** What an error calls the member. */
  readonly nameOf: (id: number) => string
}

/** An `animate` call's targets for each member's key, and its first stops when it gives any: `NaN` for none. */
export interface CallTargets {
  readonly toOf: (slot: number, k: number) => number
  readonly fromOf: ((slot: number, k: number) => number) | undefined
}

/**
 * An `animate` call's `given` targets for `slots`' members, worked out once: each key one of the Batch's
 * (`keyIndex`), its value a number, two stops (its first and its target), or a function of a member's
 * index and the count that gives one; else an error naming it.
 */
// Per member per key at a call (#665): statements.
export const callTargets = (planning: Planning, keyIndex: ReadonlyMap<string, number>, members: Members, slots: ReadonlyArray<number>, given: Readonly<Record<string, unknown>>): CallTargets => {
  const { keys, fail } = planning
  const stride = keys.length
  const top = Arr.reduce(slots, 0, (highest, slot) => Math.max(highest, slot))
  const tos = new Float64Array((top + 1) * stride).fill(Number.NaN)
  const froms = new Float64Array((top + 1) * stride).fill(Number.NaN)
  let firsts = false
  /** One stop's value for the member in `slot`: a number, or a function's of its index and the count. */
  const stopAt = (key: string, stop: unknown, slot: number): number => {
    let value = stop
    if (Predicate.isFunction(stop)) value = stop(members.indexOf(slot), members.count())
    if (Predicate.isNumber(value)) return value
    return fail(`an animate call's "${key}" gives ${members.nameOf(slot)} ${JSON.stringify(value)}: a Batch takes numbers`)
  }
  Arr.forEach(Rec.keys(given), (key) => {
    const k = keyIndex.get(key)
    if (Predicate.isUndefined(k)) return fail(`an animate call gives "${key}", which isn't one of the Batch's keys (${keys.join(", ")})`)
    const value = given[key]
    Arr.forEach(slots, (slot) => {
      const at = slot * stride + k
      let stops = value
      if (Predicate.isFunction(value)) stops = value(members.indexOf(slot), members.count())
      if (isPair(stops)) {
        froms[at] = stopAt(key, stops[0], slot)
        tos[at] = stopAt(key, stops[1], slot)
        firsts = true
        return
      }
      if (Predicate.isNumber(stops)) {
        tos[at] = stops
        return
      }
      return fail(`an animate call's "${key}" is ${JSON.stringify(stops)}: a Batch takes a number or two, its first and its target, or a function of a member's index that gives them`)
    })
  })
  const toOf = (slot: number, k: number): number => tos[slot * stride + k] as number
  const fromOf = (slot: number, k: number): number => froms[slot * stride + k] as number
  return { toOf, fromOf: Bool.match(firsts, { onTrue: () => fromOf, onFalse: () => undefined }) }
}

/**
 * A sequence's Segment of a Batch's values (Q38, Q39), for the members moving there, in order: each key
 * one of the Batch's (`hasKey`), its value a number, `null` or stops, or a function of a member's index
 * and the count that gives them, called for each member as core's Sequence compiles it.
 */
export const segmentValues = (
  planning: Planning,
  hasKey: (key: string) => boolean,
  members: Members,
  moving: ReadonlyArray<number>,
  target: Readonly<Record<string, unknown>>,
): Readonly<Record<string, Sequence.Value>> => {
  const { keys, fail } = planning
  const values: Record<string, Sequence.Value> = {}
  Arr.forEach(Rec.keys(target), (key) => {
    const value = target[key]
    if (Predicate.isUndefined(value)) return
    if (!hasKey(key)) return fail(`a sequence's Segment of a Batch gives "${key}", which isn't one of its keys (${keys.join(", ")})`)
    if (Predicate.isFunction(value)) {
      values[key] = (index: number) => segmentValueOf(key, value(members.indexOf(moving[index] as number), members.count()), members.nameOf(moving[index] as number), fail)
      return
    }
    values[key] = segmentValueOf(key, value, undefined, fail)
  })
  return values
}

/** A sequence's call of a Batch's members: its scope's settings. */
export interface SequenceCall {
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
}

/**
 * A sequence's keyframes for each member's key (#665, Q36), from the animation core's Sequence compiled
 * for the member in `slot` (`animationAt`): its stops and tween; reduced motion's Snap of a positional
 * key, or `skipAnimations`, landing it at once where its run would end.
 */
// Per member per key, once at its first play (#665): statements.
export const keyframesFor = (planning: Planning, call: SequenceCall, animationAt: (slot: number) => Sequence.Animation) =>
  (slot: number, k: number): Batch.Keyframes | undefined => {
    const key = planning.keys[k] as string
    const animation = animationAt(slot)
    const given = animation.keyframes[key]
    if (Predicate.isUndefined(given)) return undefined
    const transition = UndefinedOr.getOrThrow(animation.transition[key])
    const stops = Arr.map(given, stopNumber)
    const snaps = call.reducedMotion && planning.positionalKeys.isPositional(key)
    if (!call.skipAnimations && !snaps) return { stops, transition }
    // Where its run would end, from where it is: after its delay for reduced motion's Snap, at once when
    // skipped. Its last stop is its last number: a sequence ends a key with a `null` when its last Segment ends first.
    const end = ReducedMotion.endOf(stops[0] as number, lastNumber(stops), transition)
    let delay = 0
    if (!call.skipAnimations && Predicate.isNotUndefined(transition.delay)) delay = transition.delay
    return { stops: [Number.NaN, end], transition: landingAfter(delay) }
  }

/** Whether a sequence's subject is a Batch member's entry: a binding and its member's number. */
export const isMember: Predicate.Refinement<unknown, Imperative.BatchMember> = /*#__PURE__*/ Predicate.and(
  /*#__PURE__*/ Predicate.hasProperty("binding"),
  /*#__PURE__*/ Predicate.hasProperty("member"),
) as Predicate.Refinement<unknown, Imperative.BatchMember>

/**
 * A compiled sequence's parts (Q40): each Batch's members as one part, in the order they first appear,
 * with their animations; every other subject as it is. `restOf` gives what of a member's animation its
 * Subject takes itself (the DOM's member element's keys the Batch doesn't draw), when it takes any.
 */
export const sequencePartsOf = <X, S>(
  compiled: ReadonlyArray<readonly [X | Imperative.BatchMember, Sequence.Animation]>,
  restOf?: (member: Imperative.BatchMember, animation: Sequence.Animation) => readonly [S, Sequence.Animation] | undefined,
): { readonly batches: ReadonlyArray<Imperative.SequencePart>; readonly others: ReadonlyArray<readonly [X | S, Sequence.Animation]> } => {
  const byBinding = new Map<Imperative.BatchCalls, { readonly members: Array<number>; readonly animations: Array<Sequence.Animation> }>()
  const others: Array<readonly [X | S, Sequence.Animation]> = []
  Arr.forEach(compiled, ([subject, animation]) => {
    if (!isMember(subject)) {
      others.push([subject as X, animation])
      return
    }
    let part = byBinding.get(subject.binding)
    if (Predicate.isUndefined(part)) {
      part = { members: [], animations: [] }
      byBinding.set(subject.binding, part)
    }
    part.members.push(subject.member)
    part.animations.push(animation)
    if (Predicate.isUndefined(restOf)) return
    const rest = restOf(subject, animation)
    if (Predicate.isNotUndefined(rest)) others.push(rest)
  })
  return { batches: Arr.map(Arr.fromIterable(byBinding), ([binding, part]): Imperative.SequencePart => ({ binding, ...part })), others }
}

