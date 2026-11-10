/**
 * `createBatch`'s work (#665), Solid-free: one core Batch for a collection of elements, its members
 * entered as their elements arrive, and each change of their targets one Retarget of them all. Both
 * bindings' `createBatch` build on it, each tracking its config's `animate` with its own Solid.
 *
 * - **Its keys** are the ones its members' first targets and starts give: fixed when it's made, as a
 *   Batch's are (ADR-0069, decision 10). A key a later `animate` gives is an error naming it.
 * - **A member** is an element given to its handle's `ref`. It starts from `initial`, else at each
 *   key's identity, as an element does with no style of its own; with `initial: false`, at its target.
 *   An element its framework makes again for the same member carries on where the last one was.
 * - **A change** turns every member toward its targets in one Retarget: a member whose targets are
 *   unchanged gets nothing, and `delay: stagger()` counts the members it moves (ADR-0069, *Amendment
 *   (#665)*).
 * - **Its transitions** are a Wardic element's, read as each change starts: the config's, else the
 *   nearest `WardicConfig`'s; each key's own entry and its `delay`; the Environment's Default
 *   transition for a key without one; reduced motion's Snap for a positional key; `skipAnimations`.
 *
 * @module
 */
// ADR-0070 decisions 10–15 and *Amendment (#665)*. The DOM's writer, imported here so an app that never
// makes a Batch ships none of it (ADR-0070, *Amendment (#665)*).
import * as Batch from "@wardic/core/Batch"
import * as BaseValue from "@wardic/core/BaseValue"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as Machine from "@wardic/core/Machine"
import type * as Playback from "@wardic/core/Playback"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Sequence from "@wardic/core/Sequence"
import * as DomBatch from "@wardic/dom/DomBatch"
import * as Report from "@wardic/dom/Report"
import * as Svg from "@wardic/dom/Svg"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import type * as Fiber from "effect/Fiber"
import { identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition } from "./config.ts"
import { type Run, runOf, transitionForKey } from "./retarget-legs.ts"
import type { WardicRuntime } from "./runtime.ts"

/** The keys a Batch's members animate on the DOM: the transforms and `opacity`, as numbers. */
export type WardicBatchKey =
  | "x" | "y" | "z" | "translateX" | "translateY" | "translateZ"
  | "scale" | "scaleX" | "scaleY"
  | "rotate" | "rotateX" | "rotateY" | "rotateZ"
  | "skewX" | "skewY"
  | "opacity"

/** A member's values: numbers on its keys, in `px` for a move, degrees for a turn, unitless for a scale and `opacity`. */
export type WardicBatchValues = { readonly [K in WardicBatchKey]?: number }

/**
 * A Batch's transition: a Wardic element's, its `delay` seconds, or a `stagger()`, which holds each
 * member by its place among the members a change moves.
 */
export type WardicBatchTransition = WardicTransition extends infer T
  ? T extends unknown ? Omit<T, "delay"> & { readonly delay?: number | ((index: number, total: number) => number) } : never
  : never

/** A stop of a Batch's `animate` call: a number for every member, or a function of its index and the Batch's count. */
export type WardicBatchStop = number | ((i: number, n: number) => number)

/**
 * A Batch's targets for an `animate` call, key by key: a stop, or two, the member's first and its
 * target; or a function of the member's index and the count that gives one or two.
 */
// ADR-0069 decision 14: Motion's two-stop form, for every member or per member, `(i) => [-2, rowY(i)]`.
export type WardicBatchTarget = {
  readonly [K in WardicBatchKey]?: WardicBatchStop | readonly [WardicBatchStop, WardicBatchStop] | ((i: number, n: number) => number | readonly [number, number])
}

/**
 * A Batch's key in a sequence's Segment of it: a number for every member, `null` for where it is, stops
 * of them, or a function of a member's index and the Batch's count that gives one of them.
 */
// #665, Q38: as `animate(grid, …)`'s, its stops placed over the sequence.
export type WardicBatchSegmentValue = number | null | ReadonlyArray<number | null> | ((i: number, n: number) => number | null | ReadonlyArray<number | null>)

/** A sequence's Segment of a Batch's values, key by key: each one of its keys. */
export type WardicBatchSegmentTarget = { readonly [K in WardicBatchKey]?: WardicBatchSegmentValue }

/** What `createAnimate`'s `animate` takes for a Batch: one, by index or keyed, or a member's handle, `grid.at(i)` or `grid.member(key)`. */
export type WardicBatchSubject = { readonly at: (i: number, props?: never) => unknown } | { readonly member: (key: never, props?: never) => unknown } | { readonly ref: (el: never) => void }

/** A Batch's landing: how many members set off in the flight that landed. */
export interface WardicBatchLanding {
  readonly moved: number
}

/** What both bindings' `createBatch` take by index: `count` members, each by its index. */
export interface BatchConfig {
  /** How many members it has: read once. */
  readonly count: number
  /** Where each member starts: values, a function of its index, or `false` to start at its targets. */
  readonly initial?: false | WardicBatchValues | ((i: number) => WardicBatchValues)
  /** Each member's targets, by its index: tracked, so a change turns every member once. */
  readonly animate: (i: number) => WardicBatchValues
  /** How they move: else the nearest `WardicConfig`'s, else each key's Default transition. */
  readonly transition?: WardicBatchTransition
}

/**
 * What both bindings' `createBatch` take in the keyed form (#665, Q42–Q45): a list's items, each a member
 * by its key, entering as its element arrives and leaving as it leaves the list.
 */
export interface KeyedBatchConfig<T> {
  /** The items, in order: tracked, so a change of the list, or of its order, turns every member once. */
  readonly each: () => ReadonlyArray<T>
  /** Each item's key: the name of its property, or a function of it (Q43). */
  readonly key: keyof T | ((item: T) => unknown)
  /** Its keys, fixed up front: else the first members' targets and starts give them (Q51). */
  readonly keys?: ReadonlyArray<WardicBatchKey>
  /** Where each member starts: values, a function of its item and index, or `false` to start at its targets. */
  readonly initial?: false | WardicBatchValues | ((item: T, i: number) => WardicBatchValues)
  /** Each member's targets, by its item and its index in `each`: tracked, so a change turns every member once. */
  readonly animate: (item: T, i: number) => WardicBatchValues
  /** How they move: else the nearest `WardicConfig`'s, else each key's Default transition. */
  readonly transition?: WardicBatchTransition
}

/** Whether a Batch's config is the keyed form's. */
export const isKeyed = (config: BatchConfig | KeyedBatchConfig<unknown>): config is KeyedBatchConfig<unknown> => Predicate.hasProperty(config, "each")

/** What a Batch needs from its provider. */
export interface BatchEnv {
  readonly runtime: WardicRuntime
  readonly reducedMotion: () => boolean
  readonly skipAnimations: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
  /** The nearest `WardicConfig`'s transition, read as each change starts. */
  readonly configTransition: () => WardicTransition | undefined
  /** Its binding's Solid's `untrack`: a keyed Batch reads its list again at a task's end, outside its tracking. */
  readonly untrack: <A>(read: () => A) => A
}

/** What a Batch tells its binding: a flight's start, and its landing. */
export interface BatchHooks {
  readonly started: () => void
  readonly landed: (landing: WardicBatchLanding) => void
}

/** A Batch bound to its config: its targets, read by the binding's tracking, and what it does with them. */
export interface BatchBinding {
  /** Every member's targets now, read in the binding's tracking: a compute, which writes nothing shared. */
  readonly targetsOf: () => BatchTargets
  /** A change: every member turned toward `targets`; in the keyed form, members entering and leaving. */
  readonly apply: (targets: BatchTargets) => void
  /** Member `i`'s `ref`: one function a member. */
  readonly refOf: (i: number) => (el: Element) => void
  /** The keyed form's member for `key`, made at its first handle: its number. */
  readonly memberFor: (key: unknown) => number
  /** The members a Batch or a member's handle names: `undefined` for every member, none once a handle's member has left. */
  readonly namedOf: (entry: BatchSubjectEntry) => ReadonlyArray<number> | undefined
  /** An element's own `style`, without the properties the Batch draws on it. */
  readonly styleOf: <Style>(style: Style) => Style
  /** An `animate` call's track over its members, or the members `members` names, driven by `head`. */
  readonly track: (call: BatchCall) => BatchTrack
  /** Member `i`'s entry, for `animate`: its handle's and its element's. */
  readonly entryOf: (i: number) => BatchMemberEntry
  /** Where an element call's `key` goes for a member's element. */
  readonly routeOf: (key: string) => KeyRoute
  /** A sequence's Segment of the Batch, or of the members `named` names: its members' entries, in member order, and its values for core. */
  readonly segmentOf: (named: ReadonlyArray<number> | undefined, target: Readonly<Record<string, unknown>>) => BatchSegment
  /** A sequence's Segment of members' elements: each Batch key a number, `null` or stops, and no transform the Batch draws without it. */
  readonly checkElementSegment: (target: Readonly<Record<string, unknown>>) => void
  /** A sequence's track over its members, each through its own Batch keys' stops, driven by `head`. */
  readonly sequenceTrack: (call: BatchSequenceCall) => BatchTrack
  /** Member `i`'s element, once it has arrived. */
  readonly elementOf: (i: number) => Element | undefined
  /** The Batch's run ended, and no member drawn again. */
  readonly dispose: () => void
}

/**
 * Every member's targets at a change: by index, member by member in key order, `NaN` for a key a member's
 * targets leave out; keyed, each item, its key and its targets as `animate` gave them.
 */
export type BatchTargets = Float64Array | KeyedTargets

/** A keyed Batch's targets at a change: its items in order, their keys, and each one's targets. */
interface KeyedTargets {
  readonly items: ReadonlyArray<unknown>
  readonly keys: ReadonlyArray<unknown>
  readonly values: ReadonlyArray<Readonly<Record<string, unknown>>>
}

/** An `animate` call of a Batch: its targets, its transition, its scope's settings, its Playhead and landing. */
export interface BatchCall {
  readonly target: WardicBatchTarget
  readonly transition: WardicTransition | undefined
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
  readonly head: Playback.Playhead
  readonly settled: () => void
  /** The members it moves, in order: every member when left out. */
  readonly members: ReadonlyArray<number> | undefined
}

/** A sequence's Segment of a Batch for core (#665, Q38, Q39): its subjects, the members whose elements have arrived, and its values. */
export interface BatchSegment {
  readonly subjects: ReadonlyArray<BatchMemberEntry>
  readonly values: Readonly<Record<string, Sequence.Value>>
}

/** A sequence's part for a Batch: its members, in order, each one's compiled animation, its scope's settings, its Playhead and landing. */
export interface BatchSequenceCall {
  readonly members: ReadonlyArray<number>
  readonly animations: ReadonlyArray<Sequence.Animation>
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
  readonly head: Playback.Playhead
  readonly settled: () => void
}

/**
 * Where an element call's key goes for a member's element (#665, Q14, Q33): the Batch's own key to
 * the Batch; a transform the Batch draws without it, nowhere (its write would be the Batch's to
 * overwrite); any other to a plain animation of the element.
 */
export type KeyRoute = "batch" | "drawn" | "free"

/** What an `animate` call's Playback controls act on: an Imperative track's shape (`spine.ts`). */
export interface BatchTrack {
  readonly run: () => void
  readonly stop: () => void
  readonly cancel: () => void
  readonly duration: () => number
}

/** What `animate` knows of a Batch or a member's handle: its binding, and a handle's member by its index. */
export interface BatchSubjectEntry {
  readonly binding: BatchBinding
  readonly member: number | undefined
}

/** A member's entry: its handle's and its element's. */
export interface BatchMemberEntry extends BatchSubjectEntry {
  readonly member: number
}

/** Each Batch and member handle's entry, so `animate` knows them. */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const SUBJECTS = new WeakMap<object, BatchSubjectEntry>()

/** Each member's element's entry, while it's the member's, so `animate` of the element moves the member (Q14). */
// Module state (#460, Q7): held weakly by the element.
const MEMBER_ELEMENTS = new WeakMap<Element, BatchMemberEntry>()

/** `handle` is `binding`'s Batch, for `animate`. */
export const registerBatch = (handle: object, binding: BatchBinding): void => {
  SUBJECTS.set(handle, { binding, member: undefined })
}

/** The binding `subject` is a Batch or member handle of, for `animate`; `undefined` for anything else. */
export const batchSubjectOf = (subject: unknown): BatchSubjectEntry | undefined => {
  if (!Predicate.isObject(subject)) return undefined
  return SUBJECTS.get(subject)
}

// --- An element call on members' elements (#665, Q14, Q33–Q35) ----------------------------------

/** An element call's part for one Batch's member elements: the members, in list order, and the Batch's keys' stops. */
export interface MembersPart {
  readonly binding: BatchBinding
  readonly members: ReadonlyArray<number>
  readonly target: WardicBatchTarget
}

/** An element call's part for one element: its index in the list, and what a plain animation of it takes. */
export interface ElementPart<T> {
  readonly element: Element
  readonly index: number
  readonly target: T
}

/** Whether `value` is a Batch's key's first stop through an element: a number, or `null` for where it is. */
const isFirstStop: Predicate.Predicate<unknown> = Predicate.or(Predicate.isNumber, Predicate.isNull)

/** Whether `value` is a Batch's key's two stops through an element: a first stop, and a number. */
const isElementStops = (value: unknown): value is readonly [number | null, number] => {
  if (!isPair(value)) return false
  if (!Predicate.isNumber(value[1])) return false
  return isFirstStop(value[0])
}

/** A Batch's key's stops given through an element (Q34): a number, or two stops, a first `null` where it is. */
const elementStopsOf = (key: string, value: unknown): number | readonly [number, number] => {
  if (Predicate.isNumber(value)) return value
  if (!isElementStops(value)) {
    return fail(`an animate call gives a member's element "${key}" as ${JSON.stringify(value)}: the Batch draws "${key}", which takes a number, or two stops, its first and its target`)
  }
  if (Predicate.isNull(value[0])) return value[1]
  return value as readonly [number, number]
}

/** What a transform the Batch draws without it says (Q33): its whole `transform` is the Batch's. */
const drawnKey = (key: string): never => {
  if (key === "transform") {
    return fail(`an animate call gives a member's element "transform": the Batch draws its whole transform from its keys, so give them as keys (x, scale, rotate…) of the Batch`)
  }
  return fail(`an animate call gives a member's element "${key}", a transform the Batch draws without it: make the Batch with "${key}" among its keys, in its \`animate\` or \`initial\``)
}

/** A target split for one Batch's members' elements: the Batch's keys' stops, and the rest, `undefined` when nothing is left. */
interface MembersSplit<T> {
  readonly batch: WardicBatchTarget
  readonly rest: T | undefined
}

/** `target` split by `routeOf` for a Batch's members' elements; the rest is what a plain element's call would take. */
const splitFor = <T extends object>(routeOf: (key: string) => KeyRoute, target: T): MembersSplit<T> => {
  const fields = target as Readonly<Record<string, unknown>>
  const batch: Record<string, number | readonly [number, number]> = {}
  const rest: Record<string, unknown> = {}
  let hasRest = false
  Arr.forEach(Rec.keys(fields), (key) => {
    const route = routeOf(key)
    if (route === "drawn") return drawnKey(key)
    if (route === "batch") {
      batch[key] = elementStopsOf(key, fields[key])
      return
    }
    rest[key] = fields[key]
    hasRest = true
  })
  return { batch: batch as WardicBatchTarget, rest: Bool.match(hasRest, { onTrue: () => rest as T, onFalse: () => undefined }) }
}

/** Whether `element` is a Batch member's element: one WeakMap read, so a call without one keeps the plain path. */
export const isMemberElement = (element: Element): boolean => MEMBER_ELEMENTS.has(element)

/** `element`'s member's entry, while it's a Batch member's element: its subject in a sequence (Q40). */
export const memberEntryOf = (element: Element): BatchMemberEntry | undefined => MEMBER_ELEMENTS.get(element)

/** Whether a sequence's subject is a Batch member's entry. */
export const isMemberEntry: Predicate.Refinement<unknown, BatchMemberEntry> = Predicate.and(Predicate.hasProperty("binding"), Predicate.hasProperty("member")) as Predicate.Refinement<unknown, BatchMemberEntry>

// --- A sequence's Segments of Batches (#665, Q36–Q40) ---------------------------------------------

/** A sequence's part for one Batch: its members, in the order they first appear, and each one's compiled animation. */
export interface SequencePart {
  readonly binding: BatchBinding
  readonly members: ReadonlyArray<number>
  readonly animations: ReadonlyArray<Sequence.Animation>
}

/** `animation` with only the keys `keep` keeps; `undefined` when it keeps none. */
const keysKept = (animation: Sequence.Animation, keep: (key: string) => boolean): Sequence.Animation | undefined => {
  const keyframes = Rec.filter(animation.keyframes, (_, key) => keep(key))
  if (Rec.isEmptyRecord(keyframes)) return undefined
  return { keyframes, transition: Rec.filter(animation.transition, (_, key) => keep(key)) }
}

/**
 * A compiled sequence's parts (Q40): each Batch's members as one part, in the order they first appear,
 * their Batch keys its; each member's other keys as its element's; every other subject as it is.
 */
export const sequencePartsOf = <S>(compiled: ReadonlyArray<readonly [S | BatchMemberEntry, Sequence.Animation]>): {
  readonly batches: ReadonlyArray<SequencePart>
  readonly others: ReadonlyArray<readonly [S | Element, Sequence.Animation]>
} => {
  const byBinding = new Map<BatchBinding, { readonly members: Array<number>; readonly animations: Array<Sequence.Animation> }>()
  const others: Array<readonly [S | Element, Sequence.Animation]> = []
  Arr.forEach(compiled, ([subject, animation]) => {
    if (!isMemberEntry(subject)) {
      others.push([subject as S, animation])
      return
    }
    const { binding, member } = subject
    let part = byBinding.get(binding)
    if (Predicate.isUndefined(part)) {
      part = { members: [], animations: [] }
      byBinding.set(binding, part)
    }
    part.members.push(member)
    part.animations.push(animation)
    // Its keys the Batch doesn't have, its element's: a member element's Segment gave them.
    const rest = keysKept(animation, (key) => binding.routeOf(key) !== "batch")
    const element = binding.elementOf(member)
    if (Bool.and(Predicate.isNotUndefined(rest), Predicate.isNotUndefined(element))) others.push([element as Element, rest as Sequence.Animation])
  })
  return { batches: Arr.map(Arr.fromIterable(byBinding), ([binding, part]): SequencePart => ({ binding, ...part })), others }
}

/**
 * An element call's parts (#665, Q14, Q35): each Batch's member elements as one part, in list order,
 * with the Batch's keys; each element, a member's with the keys left, as one of its own.
 */
export const callPartsOf = <T extends object>(elements: ReadonlyArray<Element>, target: T): { readonly members: ReadonlyArray<MembersPart>; readonly elements: ReadonlyArray<ElementPart<T>> } => {
  const byBinding = new Map<BatchBinding, { readonly members: Array<number>; readonly split: MembersSplit<T> }>()
  const parts: Array<ElementPart<T>> = []
  Arr.forEach(elements, (element, index) => {
    const entry = MEMBER_ELEMENTS.get(element)
    if (Predicate.isUndefined(entry)) {
      parts.push({ element, index, target })
      return
    }
    let part = byBinding.get(entry.binding)
    if (Predicate.isUndefined(part)) {
      part = { members: [], split: splitFor(entry.binding.routeOf, target) }
      byBinding.set(entry.binding, part)
    }
    part.members.push(entry.member)
    // Its other keys by its place in the list, as a plain element's (Motion's `delay(i, n)`).
    const rest = part.split.rest
    if (Predicate.isNotUndefined(rest)) parts.push({ element, index, target: rest })
  })
  const members = Arr.filter(
    Arr.map(Arr.fromIterable(byBinding), ([binding, part]): MembersPart => ({ binding, members: part.members, target: part.split.batch })),
    (part) => !Rec.isEmptyRecord(part.target as Readonly<Record<string, unknown>>),
  )
  return { members, elements: parts }
}

/** The props an element gives a member's handle: its own `ref`, and its own `style`, as an object. */
export interface MemberProps<E extends Element, Style> {
  readonly ref?: (el: E) => void
  readonly style?: Style
}

/** A member's handle: spread onto its element. */
export interface Member<E extends Element, Style> {
  readonly ref: (el: E) => void
  readonly style?: Style | undefined
}

/** What an error about a Batch says. */
const fail = (message: string): never => {
  throw new Error(`createBatch: ${message}`)
}

/** Whether `i` is one of `count` members' indices. */
const isMember = (i: number, count: number): boolean => Number.isInteger(i) && i >= 0 && i < count

const noMember = (i: number, count: number): never => fail(`it has no member ${i}: its count is ${count}`)

/** Each key's identity: a transform's, and `opacity`'s 1, an element's own with no style of its own. */
// Per member per key at mount (#540): statements.
const identityOf = (key: string): number => {
  const identity = BaseValue.TRANSFORM_IDENTITY[key]
  if (Predicate.isUndefined(identity)) return 1
  return identity
}

/** An `initial` as values, a function's called by `call`, or `undefined` for none (`false` included). */
const startGiven = <F>(initial: false | WardicBatchValues | F | undefined, call: (made: F) => WardicBatchValues): Readonly<Record<string, unknown>> | undefined => {
  if (Predicate.isUndefined(initial) || initial === false) return undefined
  if (Predicate.isFunction(initial)) return call(initial as F)
  return initial as Readonly<Record<string, unknown>>
}

/** `initial` for member `i`, as values, or `undefined` for none. */
const initialOf = (config: BatchConfig, i: number): Readonly<Record<string, unknown>> | undefined =>
  startGiven(config.initial, (made: (i: number) => WardicBatchValues) => made(i))

/** The keys `count` members give, in the order they first appear: what their first targets and starts name. */
const keysFrom = (count: number, targetsAt: (i: number) => Readonly<Record<string, unknown>>, startAt: (i: number) => Readonly<Record<string, unknown>> | undefined): ReadonlyArray<string> => {
  const seen = new Set<string>()
  // Per member at the Batch's making, once (#665): a loop over its targets' keys and its start's.
  for (let i = 0; i < count; i++) {
    for (const key in targetsAt(i)) seen.add(key)
    const start = startAt(i)
    if (Predicate.isNotUndefined(start)) for (const key in start) seen.add(key)
  }
  return Arr.fromIterable(seen)
}

/** The keys a Batch's members give by index. */
const keysOf = (config: BatchConfig): ReadonlyArray<string> =>
  keysFrom(config.count, (i) => config.animate(i) as Readonly<Record<string, unknown>>, (i) => initialOf(config, i))

/** One change that lands every key at once: `skipAnimations`'. */
const INSTANT: Batch.Transition = { type: "tween", duration: 0 }

/** A sequence's run that lands a key at once after `delay`: `skipAnimations`', and reduced motion's Snap of a positional key. */
// Module state (#460, Q7): a cache built once, keyed by what it caches.
const LANDINGS = new Map<number, Machine.KeyframesOptions>()

const landingAfter = (delay: number): Machine.KeyframesOptions => {
  const known = LANDINGS.get(delay)
  if (Predicate.isNotUndefined(known)) return known
  const made: Machine.KeyframesOptions = { duration: 0, delay }
  LANDINGS.set(delay, made)
  return made
}

/** A Batch key's stop in a sequence, as core's Batch takes it: a number, `NaN` for `null`. */
const stopNumber = (stop: Sequence.Stop): number => {
  if (Predicate.isNumber(stop)) return stop
  return Number.NaN
}

/** A key's last stop that's a number, `NaN` (where it is) for none: what its `null`s after it hold. */
const lastNumber = (stops: ReadonlyArray<number>): number =>
  Option.getOrElse(Arr.findLast(stops, (stop) => !Number.isNaN(stop)), () => Number.NaN)

/** Whether `value` is a Batch key's value in a sequence: a number, `null`, or stops of them. */
const isSegmentStops = (value: unknown): boolean => {
  if (isFirstStop(value)) return true
  if (!Arr.isArray(value)) return false
  return Arr.every(value, isFirstStop)
}

/** A Batch key's value in a sequence (Q38): a number, `null` or stops of them; else an error naming the key, and the member a function gave it. */
const segmentValueOf = (key: string, value: unknown, memberName: string | undefined): Sequence.Stop | ReadonlyArray<Sequence.Stop> => {
  if (isSegmentStops(value)) return value as Sequence.Stop | ReadonlyArray<Sequence.Stop>
  const whose = UndefinedOr.match(memberName, { onUndefined: () => "", onDefined: (name) => `${name}'s ` })
  return fail(`a sequence gives ${whose}"${key}" as ${JSON.stringify(value)}: a Batch's key takes a number, \`null\`, or stops of them`)
}

/** A member's slot before its element arrives. */
const NO_SLOT = -1

/** Whether `value` is two stops. */
const isPair = (value: unknown): value is readonly [unknown, unknown] => {
  if (!Arr.isArray(value)) return false
  return value.length === 2
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

const delayedBy = (transition: Batch.Transition, delay: number): Batch.Transition => {
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
const UNSTAGGERED = new WeakMap<object, WardicTransition>()

const unstaggered = (given: WardicBatchTransition | WardicTransition): WardicTransition => {
  if (!Predicate.isFunction(given.delay)) return given as WardicTransition
  const known = UNSTAGGERED.get(given)
  if (Predicate.isNotUndefined(known)) return known
  const made = { ...given, delay: undefined } as unknown as WardicTransition
  UNSTAGGERED.set(given, made)
  return made
}

/** A change's `stagger()` delay, for the members it moves; `undefined` for none. */
const staggerOf = (given: WardicTransition | undefined): ((rank: number, n: number) => number) | undefined => {
  if (Predicate.isUndefined(given)) return undefined
  const delay: unknown = given.delay
  if (Predicate.isFunction(delay)) return delay as (rank: number, n: number) => number
  return undefined
}

/** A key's transition as a Batch runs it: its run, which can't be an inertia or repeat. */
const batchRunOf = (run: Run, key: string): Batch.Transition => {
  if (run.type === "inertia") fail(`"${key}" has an inertia transition, which a Batch can't run: give it a spring or a tween`)
  if (Predicate.hasProperty(run, "repeat")) fail(`"${key}"'s transition repeats, which a Batch can't run`)
  return run as Batch.Transition
}

/** A change's plan for one key: its own transition, or `undefined` for its Default transition held by `delay`. */
interface KeyPlan {
  readonly own: Batch.Transition | undefined
  readonly delay: number
}

/**
 * Each key's plan for a change, by its index, as a Wardic element's keys run (#301): its entry, else
 * `default`, else the transition's own fields; reduced motion's Snap for a positional key that doesn't
 * opt out; its Default transition, held by its own `delay`, for a key whose transition isn't defined.
 */
// Once a change, per key.
const plannedOf = (env: BatchEnv, keys: ReadonlyArray<string>, given: WardicTransition | undefined, reduced: boolean): ReadonlyArray<KeyPlan> =>
  Arr.map(keys, (key): KeyPlan => {
    const transition = transitionForKey(given, key)
    let delay = 0
    let respects = true
    if (Predicate.isNotUndefined(transition)) {
      if (Predicate.isNumber(transition.delay)) delay = transition.delay
      respects = transition.respectReducedMotion !== false
    }
    if (reduced && respects && env.positionalKeys.isPositional(key)) return { own: snapAfter(delay), delay }
    const run = runOf(transition)
    if (Predicate.isUndefined(run)) return { own: undefined, delay }
    return { own: batchRunOf(run, key), delay }
  })

/** A server render's handle: the element's own props passed on, and nothing animates. */
export const serverHandle = <Style>() =>
  <E extends Element>(_: unknown, props?: MemberProps<E, Style>): Member<E, Style> => {
    if (Predicate.isUndefined(props)) return { ref: noop }
    return { ref: noop, style: props.style }
  }

const noop = (): void => {}

/** Member handles for `binding`: its `ref`, the element's own `ref` called beside it, and its own `style` kept. */
export const handlesOf = <Style>(binding: BatchBinding) =>
  <E extends Element>(i: number, props?: MemberProps<E, Style>): Member<E, Style> => {
    const handle = memberHandleOf<E, Style>(binding, i, props)
    // Known to `animate`, as member `i`'s: its entry made once, so a handle made at each render costs its
    // WeakMap write alone (0.09 ms a 1,000 handles in Node, against 0.16 with an entry made each time; #665).
    SUBJECTS.set(handle, binding.entryOf(i))
    return handle
  }

const memberHandleOf = <E extends Element, Style>(binding: BatchBinding, i: number, props: MemberProps<E, Style> | undefined): Member<E, Style> => {
  const ref = binding.refOf(i)
  if (Predicate.isUndefined(props)) return { ref }
  const own = props.ref
  const both = (el: E): void => {
    ref(el)
    if (Predicate.isNotUndefined(own)) own(el)
  }
  // No `style` of its own: none on the handle, so a spread keeps a `style` the element gives before it (Solid 2's merge takes an `undefined` one).
  if (Predicate.isUndefined(props.style)) return { ref: both }
  return { ref: both, style: binding.styleOf(props.style) }
}

/** The nearest `WardicConfig`'s transition, read as each change starts, from either binding's config value. */
export const configTransitionOf = (config: { readonly transition: () => WardicTransition | undefined } | undefined) => (): WardicTransition | undefined => {
  if (Predicate.isUndefined(config)) return undefined
  return config.transition()
}

/** Keyed member handles for `binding`: as {@link handlesOf}'s, each key's member made at its first handle. */
export const keyedHandlesOf = <Style>(binding: BatchBinding) =>
  <E extends Element>(key: unknown, props?: MemberProps<E, Style>): Member<E, Style> => {
    const member = binding.memberFor(key)
    const handle = memberHandleOf<E, Style>(binding, member, props)
    SUBJECTS.set(handle, binding.entryOf(member))
    return handle
  }

/** A keyed member's index before its item is in `each`, or once it has left. */
const NO_INDEX = -1

/** A keyed Batch's members' keys: its config's, by property or function, each checked to give one. */
const keyReaderOf = (config: KeyedBatchConfig<unknown>): ((item: unknown, i: number) => unknown) => {
  const given = config.key
  const read: (item: unknown) => unknown = Bool.match(Predicate.isFunction(given), {
    onTrue: () => given as (item: unknown) => unknown,
    onFalse: () => (item: unknown) => (item as Readonly<Record<PropertyKey, unknown>>)[given as unknown as PropertyKey],
  })
  // Per item at a change (#665): statements.
  return (item, i) => {
    const key = read(item)
    if (Predicate.isNullish(key)) return fail(`item ${i}'s key is ${String(key)}: give each item a key, by \`key\``)
    return key
  }
}

/**
 * What a Batch's members are, chosen once as it's made: by index, `count` of them fixed; or keyed, a list's
 * items by their keys, entering and leaving with it.
 */
interface MembersForm {
  /** How many members the list has now: the `n` a function of a member's index hears. */
  readonly size: () => number
  /** How an error names member `i`: by its index, or by its key. */
  readonly nameOf: (i: number) => string
  /** Every member's targets now: a compute, which writes nothing shared. */
  readonly targetsOf: () => BatchTargets
  /** A change's targets taken in: by index, the targets; keyed, the list, members entering and leaving. */
  readonly take: (targets: BatchTargets) => void
  /** The slots of the members that have arrived: by index, in the order they did (its own list, not a copy); keyed, in the list's. */
  readonly arrivedSlots: () => ReadonlyArray<number>
  /** Every member, in order: by index, by index; keyed, in the list's. */
  readonly inOrder: () => ReadonlyArray<number>
  /** Member `i`'s `initial`, as values, or `undefined` for none. */
  readonly initialOf: (i: number) => Readonly<Record<string, unknown>> | undefined
  /** Whether member `i`'s element enters as it arrives: keyed, once the list has its key and the Batch is made. */
  readonly entersNow: (i: number) => boolean
  /** A slot entered: by index, kept in arrival order. */
  readonly entered: (slot: number) => void
  /** Member `i`'s `ref`, or the error for one it doesn't have. */
  readonly refOf: (i: number) => (el: Element) => void
  /** The keyed form's member for `key`. */
  readonly memberFor: (key: unknown) => number
}

/**
 * A Batch for `config`'s members, under `env`'s provider: its writer the DOM's. The binding tracks
 * {@link BatchBinding.targetsOf} and hands each new value to {@link BatchBinding.apply}.
 *
 * - **By index,** its `count` members are fixed, member `i` its `i`th, and its core Batch is made at once.
 * - **Keyed** (Q42–Q45), each key's member is a number, given at its key's first sight and given back when
 *   it leaves, so a long list's churn reuses them. Its core Batch is made at the first change with
 *   members, at a handle's first sight of one, or at once when its `keys` are given (Q51).
 */
export const bindBatch = (env: BatchEnv, config: BatchConfig | KeyedBatchConfig<unknown>, hooks: BatchHooks): BatchBinding => {
  const keyed = isKeyed(config)
  // The keys, and the core Batch: made at once by index, at the first change with members when keyed.
  let keys: ReadonlyArray<string> = []
  let stride = 0
  let keyIndex: ReadonlyMap<string, number> = new Map()
  let batch: Batch.Batch<Element> | undefined = undefined
  let write: (subject: Element, positions: Float64Array, base: number) => void = noop
  // The CSS properties the Batch draws, which an element's own `style` leaves to it.
  let drawn: ReadonlySet<string> = new Set()
  /** The core Batch, once it's made: every caller runs after. */
  const made = (): Batch.Batch<Element> => UndefinedOr.getOrThrow(batch)

  // Each member's slot (`NO_SLOT` before its element arrives), its index in the list (`NO_INDEX` when it
  // has none), and its element, entry and `ref`; each slot's member; and every member's targets, `stride` a member.
  let capacity = 1
  let slotOf = new Int32Array(capacity).fill(NO_SLOT)
  let indexOf = new Int32Array(capacity).fill(NO_INDEX)
  const elementOf: Array<Element | undefined> = []
  const entries: Array<BatchMemberEntry | undefined> = []
  const refs: Array<(el: Element) => void> = []
  const memberOf: Array<number> = []
  let current: Float64Array = new Float64Array(0)
  let binding: BatchBinding | undefined = undefined

  /** Room for `wanted` members: every member's typed arrays grown to the next power of two times their size that holds it. */
  // Once a growth (#665): typed arrays copied.
  const growMembersTo = (wanted: number): void => {
    if (wanted <= capacity) return
    const grown = capacity * 2 ** Math.ceil(Math.log2(wanted / capacity))
    const slots = new Int32Array(grown).fill(NO_SLOT)
    slots.set(slotOf)
    slotOf = slots
    const indices = new Int32Array(grown).fill(NO_INDEX)
    indices.set(indexOf)
    indexOf = indices
    const listings = new Int32Array(grown)
    listings.set(listedIn)
    listedIn = listings
    const targets = new Float64Array(grown * stride).fill(Number.NaN)
    targets.set(current)
    current = targets
    capacity = grown
  }

  /** Member `i`'s `values` written as its targets into `into`, `NaN` for a key they leave out; each one a number. */
  // Per member per key at a change (#665): statements.
  const targetsInto = (into: Float64Array, i: number, values: Readonly<Record<string, unknown>>): void => {
    const base = i * stride
    for (let k = 0; k < stride; k++) into[base + k] = Number.NaN
    for (const key in values) {
      const k = keyIndex.get(key)
      if (Predicate.isUndefined(k)) return fail(`${form.nameOf(i)}'s targets give "${key}", which isn't one of its keys (${keys.join(", ")}): a Batch's keys are fixed when it's made`)
      const value = values[key]
      if (Predicate.isNumber(value)) {
        into[base + k] = value
        continue
      }
      if (Predicate.isNotUndefined(value)) fail(`${form.nameOf(i)}'s "${key}" is ${JSON.stringify(value)}: a Batch's targets are numbers, one each`)
    }
  }

  const configuredOf = (): WardicTransition | undefined => {
    const given = config.transition as WardicTransition | undefined
    if (Predicate.isNotUndefined(given)) return given
    return env.configTransition()
  }
  /** A key's Default transition toward `target`. */
  const defaultFor = (k: number, target: number): Batch.Transition => env.defaultTransition.transitionFor(keys[k], target) as Batch.Transition

  /** The Batch's keys, fixed from now on, and room for every member's targets on them. */
  const keysAre = (given: ReadonlyArray<string>): void => {
    keys = given
    stride = given.length
    keyIndex = new Map(Arr.map(given, (key, k) => [key, k] as const))
    current = new Float64Array(capacity * stride).fill(Number.NaN)
  }

  /**
   * The core Batch: its own transitions each key's as it is now, so the members a change gives them step by
   * one matrix while they share one (ADR-0069, *Amendment (#665)*), the Default transition toward
   * `firstTarget(k)`, its first member's, for a key without one.
   */
  const makeBatch = (firstTarget: (k: number) => number): void => {
    const ownPlan = plannedOf(env, keys, UndefinedOr.map(configuredOf(), unstaggered), false)
    const own: Record<string, Batch.Transition> = {}
    Arr.forEach(keys, (key, k) => {
      const plan = ownPlan[k]
      if (Predicate.isNotUndefined(plan.own)) {
        own[key] = plan.own
        return
      }
      let target = firstTarget(k)
      if (Number.isNaN(target)) target = identityOf(key)
      own[key] = delayedBy(defaultFor(k, target), plan.delay)
    })
    batch = Batch.make({ keys, writer: DomBatch.writer, transition: own, capacity })
    // The writer's write for these keys, built once: an arriving element is drawn with it at once.
    write = DomBatch.writer.forKeys(keys)
    drawn = new Set([
      ...Arr.filter(["transform"], () => Arr.some(keys, (key) => key !== "opacity")),
      ...Arr.filter(["opacity"], () => keyIndex.has("opacity")),
    ])
  }

  // --- Keyed: a list's items by key (#665, Q42–Q45, Q51) ------------------------------------

  const byKey = config as KeyedBatchConfig<unknown>
  const keyReader = Bool.match(keyed, { onTrue: () => keyReaderOf(byKey), onFalse: () => (): unknown => undefined })
  // Each member's key and item, each key's member, the members given back, how many members there have
  // been, and the list's members in order.
  const keyOf: Array<unknown> = []
  const itemOf: Array<unknown> = []
  const memberOfKey = new Map<unknown, number>()
  const freeMembers: Array<number> = []
  let memberCount = 0
  let order: ReadonlyArray<number> = []
  // Which listing (a change of the list taken in) last listed each member, to tell a key given twice and the members that left.
  let listedIn = new Int32Array(capacity)
  let listings = 0

  /** Keyed: member `item`'s `initial` at `i`, as values, or `undefined` for none. */
  const keyedInitialOf = (item: unknown, i: number): Readonly<Record<string, unknown>> | undefined =>
    startGiven(byKey.initial, (given: (item: unknown, i: number) => WardicBatchValues) => given(item, i))

  /** Keyed: the items now, their keys and their targets, as `animate` gives them. A compute: it writes nothing shared. */
  const keyedTargetsOf = (): KeyedTargets => {
    const items = byKey.each()
    return {
      items,
      keys: Arr.map(items, keyReader),
      values: Arr.map(items, (item, i) => byKey.animate(item, i) as Readonly<Record<string, unknown>>),
    }
  }

  /** Keyed: the core Batch, made on `targets`' keys (else the config's `keys`) when it has members. */
  const makeFromList = (targets: KeyedTargets): void => {
    if (targets.items.length === 0) return
    keysAre(UndefinedOr.match(byKey.keys, {
      onUndefined: () => keysFrom(targets.items.length, (i) => targets.values[i], (i) => keyedInitialOf(targets.items[i], i)),
      onDefined: identity,
    }))
    makeBatch((k) => {
      const value = targets.values[0][keys[k]]
      if (Predicate.isNumber(value)) return value
      return Number.NaN
    })
  }

  /** A keyed member for `key`, at its first sight: a member given back, else the next. */
  const newMember = (key: unknown): number => {
    let member = freeMembers.pop()
    if (Predicate.isUndefined(member)) {
      member = memberCount
      memberCount = memberCount + 1
      growMembersTo(memberCount)
    }
    const i = member
    const entry: BatchMemberEntry = { binding: UndefinedOr.getOrThrow(binding), member: i }
    entries[i] = entry
    keyOf[i] = key
    indexOf[i] = NO_INDEX
    listedIn[i] = 0
    memberOfKey.set(key, i)
    // Its `ref` reaches it only while it's this key's: a handle kept past its leave reaches nothing.
    refs[i] = (el: Element) => {
      if (entries[i] === entry) arrive(i, el)
    }
    return i
  }

  /**
   * Keyed: the list now, `targets`, taken in: the core Batch made at its first members, each item's member
   * (made at its key's first sight) given its index, item and targets, and each member that left the list
   * leaving the Batch at once (3a: an exit comes with `<AnimatePresence>`, in 3b).
   */
  const takeList = (targets: KeyedTargets): void => {
    if (Predicate.isUndefined(batch)) makeFromList(targets)
    if (Predicate.isUndefined(batch)) return
    listings = listings + 1
    const next: Array<number> = []
    // Per item at a change (#665): statements.
    Arr.forEach(targets.items, (item, i) => {
      const key = targets.keys[i]
      let member = memberOfKey.get(key)
      if (Predicate.isUndefined(member)) member = newMember(key)
      if (listedIn[member] === listings) return fail(`items ${indexOf[member]} and ${i} both have the key ${JSON.stringify(key)}: each item's key is its own`)
      listedIn[member] = listings
      indexOf[member] = i
      itemOf[member] = item
      targetsInto(current, member, targets.values[i])
      next.push(member)
    })
    Arr.forEach(order, (member) => {
      if (listedIn[member] !== listings) leaveList(member)
    })
    order = next
  }

  /** Keyed: member `i` leaves the list, and the Batch at once; its number is given back. */
  const leaveList = (i: number): void => {
    const slot = slotOf[i]
    if (slot !== NO_SLOT) Batch.leave(made(), slot)
    const el = elementOf[i]
    if (Predicate.isNotUndefined(el)) forget(el, i)
    memberOfKey.delete(keyOf[i])
    keyOf[i] = undefined
    itemOf[i] = undefined
    entries[i] = undefined
    elementOf[i] = undefined
    slotOf[i] = NO_SLOT
    indexOf[i] = NO_INDEX
    reported.delete(i)
    freeMembers.push(i)
  }

  // Elements whose keys the list didn't have as they arrived, and those reported for still not having them
  // at a task's end: each enters once a change lists its key (Q45).
  let waiting: Array<number> = []
  const reported = new Set<number>()

  /** Keyed: the waiting elements whose keys the list has now, entered; the rest wait on. */
  const enterListed = (): void => {
    if (waiting.length === 0 || Predicate.isUndefined(batch)) return
    const early = waiting
    waiting = []
    Arr.forEach(early, (i) => {
      // Gone since, or entered already.
      if (Predicate.isUndefined(entries[i]) || slotOf[i] !== NO_SLOT) return
      if (indexOf[i] === NO_INDEX) {
        waiting.push(i)
        return
      }
      reported.delete(i)
      enter(i, UndefinedOr.getOrThrow(elementOf[i]))
    })
  }

  /** Keyed: the waiting elements at a task's end, the list read again: those it has entered, each other one reported once. */
  // Found at a task's end, where a throw reaches nothing: reported, and the element waits on.
  const settleWaiting = (): void => {
    if (waiting.length === 0) return
    takeList(env.untrack(keyedTargetsOf))
    enterListed()
    Arr.forEach(waiting, (i) => {
      if (reported.has(i)) return
      reported.add(i)
      const unlisted = new Error(`createBatch: an element was given ${form.nameOf(i)}'s handle, but no item in \`each\` has that key`)
      env.runtime.runFork(Report.failure("createBatch: a member's element has no item", Cause.die(unlisted)))
    })
  }

  const keyedForm: MembersForm = {
    size: () => order.length,
    nameOf: (i) => `member ${JSON.stringify(keyOf[i])}`,
    targetsOf: keyedTargetsOf,
    take: (targets) => {
      takeList(targets as KeyedTargets)
      enterListed()
    },
    arrivedSlots: () => Arr.filter(Arr.map(order, (i) => slotOf[i]), (slot) => slot !== NO_SLOT),
    inOrder: () => order,
    initialOf: (i) => keyedInitialOf(itemOf[i], indexOf[i]),
    entersNow: (i) => Bool.and(indexOf[i] !== NO_INDEX, Predicate.isNotUndefined(batch)),
    entered: noop,
    refOf: (i) => refs[i],
    // A member for a key no list has listed stays until a list does: its handle's element may arrive first.
    // On Solid 2 a spread's compute can make one Solid then throws away, so a key's member is made once.
    memberFor: (key) => {
      if (Predicate.isUndefined(batch)) makeFromList(env.untrack(keyedTargetsOf))
      const known = memberOfKey.get(key)
      if (Predicate.isNotUndefined(known)) return known
      return newMember(key)
    },
  }

  // --- By index: `count` members, fixed --------------------------------------------------

  const byIndex = config as BatchConfig
  const count = Bool.match(keyed, { onTrue: () => 0, onFalse: () => byIndex.count })
  // The slots, in the order their elements arrived.
  const entered: Array<number> = []
  // Every member, by index.
  const indices: ReadonlyArray<number> = Arr.makeBy(Math.max(1, count), identity).slice(0, count)

  /** By index: every member's targets now, member by member in key order. */
  const indexTargetsOf = (): Float64Array => {
    const targets = new Float64Array(count * stride)
    // Per member at a change, the Batch's own loop (ADR-0025, *Amendment (#665)*).
    for (let i = 0; i < count; i++) targetsInto(targets, i, byIndex.animate(i) as Readonly<Record<string, unknown>>)
    return targets
  }

  const indexForm: MembersForm = {
    size: () => count,
    nameOf: (i) => `member ${i}`,
    targetsOf: indexTargetsOf,
    take: (targets) => {
      current = targets as Float64Array
    },
    arrivedSlots: () => entered,
    inOrder: () => indices,
    initialOf: (i) => initialOf(byIndex, i),
    entersNow: () => true,
    entered: (slot) => {
      entered.push(slot)
    },
    refOf: (i) => {
      if (!isMember(i, count)) return noMember(i, count)
      return refs[i]
    },
    memberFor: () => fail(`a Batch by index has no \`member(key)\`: give its members \`at(i)\``),
  }

  const form: MembersForm = Bool.match(keyed, { onTrue: () => keyedForm, onFalse: () => indexForm })

  // --- Its members' moves ----------------------------------------------------------------

  /** Member `i`'s start: its `initial` over each key's identity, or, with `initial: false`, its targets. */
  // Per member at mount (#540): statements.
  const startOf = (i: number): Record<string, number> => {
    const start: Record<string, number> = {}
    const given = form.initialOf(i)
    if (Predicate.isNotUndefined(given)) {
      for (const key in given) {
        if (!keyIndex.has(key)) fail(`${form.nameOf(i)} starts at "${key}", which isn't one of its keys (${keys.join(", ")}): a Batch's keys are fixed when it's made`)
      }
    }
    Arr.forEach(keys, (key, k) => {
      const target = current[i * stride + k]
      let value = identityOf(key)
      if (config.initial === false && !Number.isNaN(target)) value = target
      if (Predicate.isNotUndefined(given)) {
        const own = given[key]
        if (Predicate.isNumber(own)) value = own
        if (Predicate.isNotUndefined(own) && !Predicate.isNumber(own)) fail(`${form.nameOf(i)}'s "${key}" starts at ${JSON.stringify(own)}: a Batch's values are numbers`)
      }
      start[key] = value
    })
    return start
  }

  // The runs it forked, interrupted when it's disposed; whether a flight is on, and the members it set off.
  const fibers = new Set<Fiber.Fiber<void>>()
  let flying = false
  let moved = 0
  let disposed = false

  /** A flight lands once a run ends with nothing moving: a run forked while one ran ends at once. */
  const ended = (): void => {
    if (disposed) return
    if (!flying || Batch.isMoving(made())) return
    flying = false
    hooks.landed({ moved })
  }

  /** After a change: a flight's start, if it set one off, and a run, which does nothing while one runs. */
  const wake = (setOff: number): void => {
    if (!Batch.isMoving(made())) return
    if (!flying) {
      flying = true
      moved = 0
      hooks.started()
    }
    moved = moved + setOff
    // Heard by an observer, not an `Effect.ensuring`: one primitive fewer at each change (#665's profile).
    const fiber = env.runtime.runFork(Batch.run(made()))
    fibers.add(fiber)
    fiber.addObserver(() => {
      fibers.delete(fiber)
      ended()
    })
  }

  const targetOf = (slot: number, k: number): number => current[memberOf[slot] * stride + k]

  /**
   * A change's transitions: one per key, by its name, when every key has its own; else a function of
   * a member's slot, for the keys on their Default transition, which each member's target decides.
   */
  // A function called per member's key cost a change at 1,000 members a call each (#665's profile).
  const transitionOf = (planned: ReadonlyArray<KeyPlan>): Batch.Transitions | ((slot: number, k: number) => Batch.Transition) => {
    if (Arr.every(planned, (plan) => Predicate.isNotUndefined(plan.own))) {
      const byName: Record<string, Batch.Transition> = {}
      Arr.forEach(keys, (key, k) => {
        byName[key] = UndefinedOr.getOrThrow(planned[k].own)
      })
      return byName
    }
    return (slot, k) => {
      const plan = planned[k]
      if (Predicate.isNotUndefined(plan.own)) return plan.own
      return delayedBy(defaultFor(k, targetOf(slot, k)), plan.delay)
    }
  }

  /** The change for `slots` now: their targets, with this moment's transitions. */
  const change = (slots: ReadonlyArray<number>): void => {
    if (slots.length === 0) return
    const configured = configuredOf()
    if (env.skipAnimations() || UndefinedOr.map(configured, (given) => given.skipAnimations) === true) {
      wake(Batch.retarget(made(), slots, targetOf, { transition: INSTANT }))
      return
    }
    const reduced = env.reducedMotion()
    const transition = transitionOf(plannedOf(env, keys, UndefinedOr.map(configured, unstaggered), reduced))
    const delay = staggerOf(configured)
    if (Predicate.isUndefined(delay)) {
      wake(Batch.retarget(made(), slots, targetOf, { transition }))
      return
    }
    wake(Batch.retarget(made(), slots, targetOf, { transition, delay }))
  }

  // Elements that arrived this task: entered at once, turned toward their targets together at its end.
  let arrived: Array<number> = []
  let flushing = false
  const flushArrivals = (): void => {
    flushing = false
    if (disposed) return
    settleWaiting()
    const slots = arrived
    arrived = []
    change(slots)
  }
  /** The task's arrivals flushed at its end, once. */
  const flushSoon = (): void => {
    if (flushing) return
    flushing = true
    queueMicrotask(flushArrivals)
  }

  /** `el` drawn now at `values`, one per key, and turned about its own centre inside an `<svg>`, as the renderer's. */
  const drawNow = (el: Element, values: ReadonlyArray<number>): void => {
    if (Svg.isInner(el)) {
      const style = (el as SVGElement).style
      style.setProperty("transform-box", "fill-box")
      style.setProperty("transform-origin", "50% 50%")
    }
    write(el, Float64Array.from(values), 0)
  }

  /** `el` no longer known to `animate` as member `i`'s element, unless another member has it now. */
  const forget = (el: Element, i: number): void => {
    if (MEMBER_ELEMENTS.get(el) === entries[i]) MEMBER_ELEMENTS.delete(el)
  }

  /** Member `i` entered on `el`, drawn at its start now, its move with every member that arrives this task, at its end. */
  const enter = (i: number, el: Element): void => {
    const start = startOf(i)
    const entering = Batch.enter(made(), el, start)
    slotOf[i] = entering
    memberOf[entering] = i
    form.entered(entering)
    drawNow(el, Arr.map(keys, (key) => start[key]))
    flushSoon()
    arrived.push(entering)
  }

  const arrive = (i: number, el: Element): void => {
    if (disposed) return
    if (elementOf[i] === el) return
    const was = elementOf[i]
    if (Predicate.isNotUndefined(was)) forget(was, i)
    elementOf[i] = el
    // Known to `animate`, as member `i`'s element (Q14).
    MEMBER_ELEMENTS.set(el, UndefinedOr.getOrThrow(entries[i]))
    const slot = slotOf[i]
    // A new element for a member: it takes the member over, its values, speed and delays as they are.
    if (slot !== NO_SLOT) {
      Batch.replace(made(), slot, el)
      drawNow(el, Arr.map(keys, (key) => Batch.get(made(), slot, key)))
      return
    }
    // Keyed, before the list has its key, or before the Batch is made: at the task's end, or a later change.
    if (!form.entersNow(i)) {
      waiting.push(i)
      flushSoon()
      return
    }
    enter(i, el)
  }

  /** One stop's value for member `i`: a number, or a function's of its index and the count. */
  const stopAt = (key: string, stop: unknown, i: number): number => {
    let value = stop
    if (Predicate.isFunction(stop)) value = stop(indexOf[i], form.size())
    if (Predicate.isNumber(value)) return value
    return fail(`an animate call's "${key}" gives ${form.nameOf(i)} ${JSON.stringify(value)}: a Batch takes numbers`)
  }

  /** The slots an `animate` call moves: every member's there is, or the members it names, in order, whose elements have arrived. */
  const callSlotsOf = (named: ReadonlyArray<number> | undefined): ReadonlyArray<number> =>
    UndefinedOr.match(named, {
      // A copy: the call keeps it, and members arrive after.
      onUndefined: () => [...form.arrivedSlots()],
      onDefined: (given) => Arr.filter(Arr.map(given, (i) => slotOf[i]), (slot) => slot !== NO_SLOT),
    })

  /** Where an element call's `key` goes for a member's element (Q14, Q33). */
  const routeOf = (key: string): KeyRoute => {
    if (keyIndex.has(key)) return "batch"
    if (!drawn.has("transform")) return "free"
    if (key === "transform") return "drawn"
    if (key === "opacity") return "free"
    if (DomBatch.writer.writes(key)) return "drawn"
    return "free"
  }

  /** A track that moves nothing: a call before a keyed Batch has members, which finishes at its play (Q51). */
  const landedTrack = (settled: () => void): BatchTrack => ({ run: settled, stop: noop, cancel: noop, duration: () => 0 })

  /** An `animate` call's track: its members' targets and first stops by key, its own transitions, its Playhead. */
  const track = (call: BatchCall): BatchTrack => {
    if (Predicate.isUndefined(batch)) return landedTrack(call.settled)
    const slots = callSlotsOf(call.members)
    // Each member's stops by key, its target and its first, `NaN` for none: worked out once, at the call.
    const tos = new Float64Array(capacity * stride).fill(Number.NaN)
    const froms = new Float64Array(capacity * stride).fill(Number.NaN)
    let firsts = false
    const given = call.target as Readonly<Record<string, unknown>>
    Arr.forEach(Rec.keys(given), (key) => {
      const k = keyIndex.get(key)
      if (Predicate.isUndefined(k)) return fail(`an animate call gives "${key}", which isn't one of the Batch's keys (${keys.join(", ")})`)
      const value = given[key]
      // Per member per key at a call (#665): statements.
      Arr.forEach(slots, (slot) => {
        const i = memberOf[slot]
        const at = i * stride + k
        let stops = value
        if (Predicate.isFunction(value)) stops = value(indexOf[i], form.size())
        if (isPair(stops)) {
          froms[at] = stopAt(key, stops[0], i)
          tos[at] = stopAt(key, stops[1], i)
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
    const targetOf = (slot: number, k: number): number => tos[memberOf[slot] * stride + k]
    const fromOf = (slot: number, k: number): number => froms[memberOf[slot] * stride + k]
    // Its transitions, which the Batch copies for it, so the Playhead driving them reaches its keys alone.
    const transition = Bool.match(call.skipAnimations, {
      onTrue: () => (): Batch.Transition => INSTANT,
      onFalse: () => {
        const planned = plannedOf(env, keys, UndefinedOr.map(call.transition, unstaggered), call.reducedMotion)
        return (slot: number, k: number): Batch.Transition => {
          const plan = planned[k]
          if (Predicate.isNotUndefined(plan.own)) return plan.own
          return delayedBy(defaultFor(k, targetOf(slot, k)), plan.delay)
        }
      },
    })
    const options: { -readonly [K in keyof Batch.AnimateOptions]: Batch.AnimateOptions[K] } = { head: call.head, transition, onLanded: call.settled }
    if (firsts) options.from = fromOf
    const delay = Bool.match(call.skipAnimations, { onTrue: () => undefined, onFalse: () => staggerOf(call.transition) })
    if (Predicate.isNotUndefined(delay)) options.delay = delay
    return controlsOf(Batch.animate(made(), slots, targetOf, options))
  }

  /** Whether member `i`'s element has arrived. */
  const hasArrived = (i: number): boolean => slotOf[i] !== NO_SLOT

  /** The members a sequence's Segment moves (Q39): every member whose element has arrived, in the list's order, or those `named` names once theirs have. */
  const membersOf = (named: ReadonlyArray<number> | undefined): ReadonlyArray<number> =>
    Arr.filter(UndefinedOr.match(named, { onUndefined: form.inOrder, onDefined: identity }), hasArrived)

  /** A sequence's Segment of the Batch (Q38, Q39): its members, and each key's value, a function's called with a member's index and the count. */
  const segmentOf = (named: ReadonlyArray<number> | undefined, target: Readonly<Record<string, unknown>>): BatchSegment => {
    if (Predicate.isUndefined(batch)) return { subjects: [], values: {} }
    const moving = membersOf(named)
    const values: Record<string, Sequence.Value> = {}
    Arr.forEach(Rec.keys(target), (key) => {
      const value = target[key]
      if (Predicate.isUndefined(value)) return
      if (!keyIndex.has(key)) return fail(`a sequence's Segment of a Batch gives "${key}", which isn't one of its keys (${keys.join(", ")})`)
      if (Predicate.isFunction(value)) {
        values[key] = (index: number) => segmentValueOf(key, value(indexOf[moving[index]], form.size()), form.nameOf(moving[index]))
        return
      }
      values[key] = segmentValueOf(key, value, undefined)
    })
    return { subjects: Arr.map(moving, (i) => UndefinedOr.getOrThrow(entries[i])), values }
  }

  /** A sequence's Segment of members' elements (Q40): a Batch key's value a number, `null` or stops; no transform the Batch draws without it. */
  const checkElementSegment = (target: Readonly<Record<string, unknown>>): void =>
    Arr.forEach(Rec.keys(target), (key) => {
      const route = routeOf(key)
      if (route === "drawn") return drawnKey(key)
      if (route === "batch") segmentValueOf(key, target[key], undefined)
    })

  /**
   * A sequence's track over its members (#665, Q36): each member's Batch keys through the stops and
   * tween core's Sequence compiled for it; reduced motion's Snap of a positional key, or `skipAnimations`,
   * landing it at once where its run would end, as an element's.
   */
  const sequenceTrack = (call: BatchSequenceCall): BatchTrack => {
    if (Predicate.isUndefined(batch)) return landedTrack(call.settled)
    const slots: Array<number> = []
    const animations: Array<Sequence.Animation | undefined> = []
    Arr.forEach(call.members, (i, n) => {
      const slot = slotOf[i]
      if (slot === NO_SLOT) return
      slots.push(slot)
      animations[slot] = call.animations[n]
    })
    // Per member per key, once at its first play (#665): statements.
    const keyframesOf = (slot: number, k: number): Batch.Keyframes | undefined => {
      const key = keys[k]
      const animation = UndefinedOr.getOrThrow(animations[slot])
      const given = animation.keyframes[key]
      if (Predicate.isUndefined(given)) return undefined
      const transition = UndefinedOr.getOrThrow(animation.transition[key])
      const stops = Arr.map(given, stopNumber)
      const snaps = call.reducedMotion && env.positionalKeys.isPositional(key)
      if (!call.skipAnimations && !snaps) return { stops, transition }
      // Where its run would end, from where it is: after its delay for reduced motion's Snap, at once when
      // skipped. Its last stop is its last number: a sequence ends a key with a `null` when its last Segment ends first.
      const end = ReducedMotion.endOf(stops[0], lastNumber(stops), transition)
      let delay = 0
      if (!call.skipAnimations && Predicate.isNotUndefined(transition.delay)) delay = transition.delay
      return { stops: [Number.NaN, end], transition: landingAfter(delay) }
    }
    return controlsOf(Batch.keyframes(made(), slots, keyframesOf, { head: call.head, onLanded: call.settled }))
  }

  /** A driven change's controls, as an `animate` call's track: played, it wakes the Batch's run. */
  const controlsOf = (animation: Batch.Animation): BatchTrack => ({
    run: () => {
      if (disposed) return
      wake(Batch.play(animation))
    },
    stop: () => {
      Batch.stop(animation)
      wake(0)
    },
    cancel: () => {
      Batch.cancel(animation)
      wake(0)
    },
    duration: () => Batch.durationOf(animation),
  })

  const bound: BatchBinding = {
    track,
    entryOf: (i) => UndefinedOr.getOrThrow(entries[i]),
    routeOf,
    segmentOf,
    checkElementSegment,
    sequenceTrack,
    elementOf: (i) => elementOf[i],
    targetsOf: () => form.targetsOf(),
    apply: (targets) => {
      if (disposed) return
      form.take(targets)
      if (Predicate.isUndefined(batch)) return
      change(form.arrivedSlots())
    },
    refOf: (i) => form.refOf(i),
    memberFor: (key) => form.memberFor(key),
    namedOf: (entry) => {
      if (Predicate.isUndefined(entry.member)) return undefined
      // A keyed handle kept past its member's leave names nothing: its number may be another key's now.
      if (entries[entry.member] !== entry) return []
      return [entry.member]
    },
    styleOf: <Style>(style: Style): Style => {
      if (Predicate.isString(style)) {
        return fail(`give a member's own \`style\` as an object: Solid writes a string over what the Batch draws`)
      }
      if (!Predicate.isObject(style)) return style
      return Rec.filter(style as Readonly<Record<string, unknown>>, (_, name) => !drawn.has(name)) as Style
    },
    dispose: () => {
      disposed = true
      Iter.forEach(fibers, (fiber) => fiber.interruptUnsafe())
      fibers.clear()
      Arr.forEach(elementOf, (el, i) => {
        if (Predicate.isNotUndefined(el)) forget(el, i)
      })
    },
  }
  binding = bound

  // Keyed: its first list taken in now, read as it was made (its binding calls this untracked); with `keys`
  // and no items yet, its core Batch made now too. By index: its keys are its members' first targets' and
  // starts', and its members fixed, each made now.
  if (keyed) {
    const first = keyedTargetsOf()
    if (Predicate.isNotUndefined(byKey.keys) && first.items.length === 0) {
      keysAre(byKey.keys)
      makeBatch(() => Number.NaN)
    }
    takeList(first)
    return bound
  }
  growMembersTo(Math.max(1, count))
  keysAre(keysOf(byIndex))
  current = indexTargetsOf()
  makeBatch((k) => current[k])
  Arr.forEach(indices, (i) => {
    entries[i] = { binding: bound, member: i }
    indexOf[i] = i
    refs[i] = (el: Element) => arrive(i, el)
  })
  return bound
}
