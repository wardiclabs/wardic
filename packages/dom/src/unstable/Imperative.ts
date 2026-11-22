/**
 * **Imperative animation** (#433, CONTEXT.md; Motion's `useAnimate`), for every DOM binding: an
 * **Animation scope**'s `animate`, the elements it animates, and the **Playback controls** it returns.
 * Each binding's `createAnimate()` builds on it.
 *
 * - **A Wardic element** animates through its own spine, registered here while it's mounted: the
 *   call takes the keys it animates, which stay where it leaves them until the element's own target
 *   for them changes (Motion's latest-wins).
 * - **A plain element** animates through a spine of its own (#433's Q4), with no config, presence or
 *   layout node: it starts from the element's Own value (ADR-0022) and keeps its values for the next
 *   call, velocity included. It's in the gate only while it animates, so the gate keeps nothing of an
 *   element it isn't animating.
 * - **The controls** are Motion's (`AnimationPlaybackControls`): awaitable, with `stop`, `cancel`,
 *   `complete`, `pause`, `play`, `speed`, `time` and `duration`, every element's legs run through
 *   one `Playback.Playhead`. Its `finished` resolves at a landing or `complete()`, never at a `stop()`
 *   or a `cancel()`, as Motion's.
 * - **A sequence** (#433's PR 2, Motion's) is compiled by core's `Sequence` to each subject's
 *   Keyframes over the whole sequence, run on the same controls: each element animates as a call
 *   does, and a function Segment's value, from 0, is told to its callback each frame.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (Q13): solid's `imperative.ts`, the DOM's `animate` (its Subjects
// elements, selectors and a Batch's handles), moved to dom for every DOM binding's `createAnimate`. #882
// (ADR-0073, *Amendment (#882)*, Q1): the track is core's (`@wardic/core/unstable/Imperative`); this is
// the DOM's ports into it, its elements, selectors and Batch members, and its types.
import * as Imperative from "@wardic/core/unstable/Imperative"
import * as BatchMembers from "./BatchMembers.ts"
import * as ElementSetup from "./ElementSetup.ts"
import type * as WardConfig from "./WardConfig.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Iter from "effect/Iterable"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

export { alsoTold, registerAnimatable } from "@wardic/core/unstable/Imperative"
export type {
  AnimateEnv,
  AnimationWatch,
  WardicAnimateOptions,
  WardicFunctionSegment,
  WardicPlaybackControls,
  WardicPlayState,
  WardicSegmentOptions,
  WardicSegmentTarget,
  WardicSequenceLabel,
  WardicSequenceOptions,
  WardicSequenceTime,
} from "@wardic/core/unstable/Imperative"

/** What `animate` animates: an element, a selector looked up inside the scope, or a list of elements. Motion's `ElementOrSelector`. */
export type WardicAnimationSubject = Element | string | ArrayLike<Element> | Iterable<Element> | null | undefined

/** The elements of `subject`: a selector's inside `scope`, else the page's. Core's `Subjects.resolve`. */
const subjectsOf = (subject: unknown, scope: unknown): ReadonlyArray<Element> => {
  if (Predicate.isNullish(subject)) return []
  if (Predicate.isString(subject)) return Arr.fromIterable(UndefinedOr.match(scope as Element | undefined, { onUndefined: () => document, onDefined: (el): ParentNode => el }).querySelectorAll(subject))
  if (Predicate.hasProperty(subject, "nodeType")) return [subject as Element]
  // A list's missing members left out, as Motion's.
  if (Predicate.isIterable(subject)) return Arr.filter(Arr.fromIterable(subject as Iterable<Element>), Predicate.isNotNullish)
  const list = subject as ArrayLike<Element>
  return Arr.filter(Arr.makeBy(list.length, (i) => list[i] as Element), Predicate.isNotNullish)
}

/** A Segment of elements, `[subject, target, options?]`: an element, a selector inside the scope, or a list. Motion's. */
export type WardicElementSegment =
  | readonly [subject: WardicAnimationSubject, target: Imperative.WardicSegmentTarget]
  | readonly [subject: WardicAnimationSubject, target: Imperative.WardicSegmentTarget, options: Imperative.WardicSegmentOptions]

/**
 * A Segment of a Batch, `[batch, target, options?]`: a Batch, every member whose element has arrived, in
 * member order, or a member's handle, `grid.at(i)`. Each of its keys a number, `null`, stops, or a
 * function of a member's index and the Batch's count; a `stagger()` counts the Segment's members.
 */
// #665, Q36–Q39: each member through its own stops, in the Batch.
export type WardicBatchSegment =
  | readonly [batch: BatchMembers.WardicBatchSubject, target: BatchMembers.WardicBatchSegmentTarget]
  | readonly [batch: BatchMembers.WardicBatchSubject, target: BatchMembers.WardicBatchSegmentTarget, options: Imperative.WardicSegmentOptions]

/** One step of a sequence: a label, a Segment of elements, a function Segment, or a Segment of a Batch. */
export type WardicSegment = Imperative.WardicSequenceLabel | WardicElementSegment | Imperative.WardicFunctionSegment | WardicBatchSegment

/**
 * A sequence: Segments played one after another, unless an `at` says where one starts, and labels to
 * start them at. `animate(sequence, options)` plays it. Motion's `AnimationSequence`.
 *
 * @example
 * animate([
 *   ["ul", { opacity: 1 }],
 *   ["li", { x: [-20, 0] }, { delay: stagger(0.05), at: "-0.1" }],
 * ])
 * @see https://wardic.dev/reference/solid/animation/sequences
 */
// #433's PR 2.
export type WardicAnimationSequence = ReadonlyArray<WardicSegment>

/**
 * A scope's `animate`: `animate(subject, target, options?)` animates the subject's elements to
 * `target`, and `animate(sequence, options?)` plays a sequence. Either returns its playback controls.
 * Motion's `animate`, as `useAnimate` gives it.
 */
// #433: through one Playhead.
export interface WardicAnimate {
  (subject: WardicAnimationSubject, target: WardConfig.WardicVariant, options?: Imperative.WardicAnimateOptions): Imperative.WardicPlaybackControls
  (batch: BatchMembers.WardicBatchSubject, target: BatchMembers.WardicBatchTarget, options?: Imperative.WardicAnimateOptions): Imperative.WardicPlaybackControls
  (sequence: WardicAnimationSequence, options?: Imperative.WardicSequenceOptions): Imperative.WardicPlaybackControls
}

/**
 * An element Segment's subjects (#665, Q40): each element, a member's as its member's entry, so its Batch
 * keys run in its Batch. Each Batch checks the Segment's values once.
 */
const segmentSubjectsOf = (elements: ReadonlyArray<Element>, target: Readonly<Record<string, unknown>>): ReadonlyArray<Element | BatchMembers.BatchMemberEntry> => {
  const checked = new Set<BatchMembers.BatchBinding>()
  return Arr.map(elements, (element): Element | BatchMembers.BatchMemberEntry => {
    const entry = BatchMembers.memberEntryOf(element)
    if (Predicate.isUndefined(entry)) return element
    if (Bool.not(checked.has(entry.binding))) {
      checked.add(entry.binding)
      entry.binding.checkElementSegment(target)
    }
    return entry
  })
}

/** The DOM's ports into the track: its elements and selectors, their start links, and its Batches' members. */
const DOM: Imperative.Ports<Element> = {
  subjects: {
    resolve: subjectsOf,
    startLinksOf: (element) => ElementSetup.startLinksOf(element as HTMLElement, undefined, undefined),
  },
  batches: {
    entryOf: BatchMembers.batchSubjectOf,
    hasMembers: (elements) => Arr.some(elements, BatchMembers.isMemberElement),
    callPartsOf: BatchMembers.callPartsOf,
    segmentSubjectsOf,
    // The members core hands back are the entries this port gave it, BatchMembers' own: a cast, no wrapper.
    sequencePartsOf: BatchMembers.sequencePartsOf as Imperative.Batches<Element>["sequencePartsOf"],
  },
}

/**
 * An **Animation scope**'s `animate` (#433): selectors looked up inside `scope()`, each animation
 * told to `watch` as it starts and ends. Every element's legs start in the call, on the loop by
 * the end of its task.
 */
export const scopedAnimate = (env: Imperative.AnimateEnv, scope: () => Element | undefined, watch: Imperative.AnimationWatch): WardicAnimate =>
  Imperative.make(env, DOM, scope, watch) as WardicAnimate

/** A server's `animate`: nothing to animate. */
export const serverAnimate: WardicAnimate = () => Imperative.finishedControls()

/** Whether `given` is a sequence rather than a subject (#433, Motion's `isSequence`): a list with a Segment, itself a list, in it; a list of elements has none. A binding whose `animate` is its own tells the forms apart by it (#798). */
export const isSequence: (given: unknown) => given is WardicAnimationSequence = Imperative.isSequence as (given: unknown) => given is WardicAnimationSequence

/**
 * Whether a Segment animates anything under `scope` (#798): a function Segment does, and a Batch's; a
 * Segment of elements when its subject finds one, a selector inside `scope`, else the document; a
 * label (a string, or `{ name, at }`) never. What a binding asks of a sequence before it plays it,
 * since one that animates nothing lands at once.
 */
export const segmentAnimates = (segment: WardicSegment, scope: Element | undefined): boolean => Imperative.segmentAnimates(DOM, segment, scope)

/**
 * An animation scope: give it as an element's `ref`, and `animate`'s selectors are looked up inside
 * that element. Motion's `AnimationScope`.
 */
// #433.
export interface WardicAnimationScope<T extends Element = HTMLElement> {
  /** Give it as the element's `ref`. */
  (element: T): void
  /** The element, once it's mounted. */
  readonly current: T | undefined
  /** Its animations in flight: started, and neither finished, stopped nor cancelled. */
  readonly animations: ReadonlyArray<Imperative.WardicPlaybackControls>
}

/**
 * An Animation scope's ref and what it hears of its animations (#433): each in `animations` while in
 * flight, and `also` told too (Solid 2's `settled()`). `stopAll` stops them, at its owner's cleanup.
 */
export const scopeOf = <T extends Element>(also?: Imperative.AnimationWatch): {
  readonly scope: WardicAnimationScope<T>
  readonly watch: Imperative.AnimationWatch
  readonly stopAll: () => void
} => {
  let current: T | undefined
  // A set, and its array built only when `animations` is read, then kept until the set changes (#659):
  // an array copied at every start and every end made starting and ending n of them O(n²).
  const live = new Set<Imperative.WardicPlaybackControls>()
  let listed: ReadonlyArray<Imperative.WardicPlaybackControls> | undefined
  const animationsNow = (): ReadonlyArray<Imperative.WardicPlaybackControls> => {
    if (Predicate.isUndefined(listed)) listed = Arr.fromIterable(live)
    return listed
  }
  const ref = (element: T): void => {
    current = element
  }
  const scope = Object.defineProperties(ref, {
    current: { get: () => current },
    animations: { get: animationsNow },
  }) as WardicAnimationScope<T>
  const watch = Imperative.alsoTold(
    {
      started: (controls) => {
        live.add(controls)
        listed = undefined
      },
      ended: (controls) => {
        live.delete(controls)
        listed = undefined
      },
    },
    also,
  )
  // Stopping one ends it, which deletes it from the set: safe in the set's own walk.
  return { scope, watch, stopAll: () => Iter.forEach(live, (controls) => controls.stop()) }
}
