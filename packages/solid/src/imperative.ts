/**
 * **Imperative animation** (#433, CONTEXT.md; Motion's `useAnimate`), Solid-free: an **Animation
 * scope**'s `animate`, the elements it animates, and the **Playback controls** it returns. Both
 * bindings' `createAnimate()` build on it.
 *
 * - **A Wardic element** animates through its own spine, registered here while it's mounted: the
 *   call takes the keys it animates, which stay where it leaves them until the element's own target
 *   for them changes (the spine's `animate`, Motion's latest-wins).
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
 * @module
 */
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Values from "@wardic/core/Values"
import * as Sequence from "@wardic/core/Sequence"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Report from "@wardic/dom/Report"
import { batchSubjectOf, callPartsOf, type WardicBatchSubject, type WardicBatchTarget } from "./batch.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import { constVoid, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicKeyframes, WardicTargetValues, WardicTransition, WardicVariant } from "./config.ts"
import { filledStops, runOf } from "./retarget-legs.ts"
import type { WardicRuntime } from "./runtime.ts"
import { type ElementSpine, emptySnapshotOf, type ImperativeTrack, makeElementSpine, makeReuse, type Snapshot, startLinksOf } from "./spine.ts"
import { NO_VARIANT_STATE, resolveTarget } from "./variant-target.ts"

/** What an Imperative animation animates an element through: its spine's `animate`. */
type Animatable = Pick<ElementSpine, "animate">

/** Each mounted Wardic element's spine (Motion's `visualElementStore`). */
// Module state (#460, Q7): each Wardic element's animatable, held weakly by the element.
const wardicElements = new WeakMap<Element, Animatable>()

/**
 * Register a mounted Wardic element's spine for the Imperative animations of it (#433): until the
 * returned function, which its unmount calls.
 */
export const registerAnimatable = (element: Element, spine: Animatable): (() => void) => {
  wardicElements.set(element, spine)
  return () => {
    if (wardicElements.get(element) === spine) wardicElements.delete(element)
  }
}

/** What a scope animates plain elements with: its provider's. */
export interface AnimateEnv {
  readonly runtime: WardicRuntime
  readonly gate: FlushGate.Shape
  readonly reducedMotion: () => boolean
  /**
   * Whether its animations are skipped (#468): its scope's nearest `WardicConfig`'s, read as each
   * starts, and handed to each element's animation in its transition, as Motion's `useAnimate` does.
   */
  readonly skipAnimations: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
}

/** A plain element's spine (#433's Q4), its values, and how many of its animations run, which keep it in the gate. */
interface Plain {
  readonly spine: ElementSpine
  readonly snapshot: Snapshot
  readonly id: string
  running: number
  unregister: () => void
}

/** Each gate's plain elements: a provider's own, kept while the element is. */
// Module state (#460, Q7): each gate's plain elements, held weakly by the gate.
const plainByGate = new WeakMap<FlushGate.Shape, WeakMap<Element, Plain>>()

/** The plain elements' gate ids, counted. */
// Module state (#460, Q7): an id counter, unique across every gate.
let plainIds = 0

/** No config: a plain element's. */
const NO_CONFIG = {}

/** `element`'s plain spine under `env`'s gate, made at its first animation. */
const plainOf = (env: AnimateEnv, element: Element): Plain => {
  let byElement = plainByGate.get(env.gate)
  if (Predicate.isUndefined(byElement)) {
    byElement = new WeakMap()
    plainByGate.set(env.gate, byElement)
  }
  const known = byElement.get(element)
  if (Predicate.isNotUndefined(known)) return known
  const el = element as HTMLElement
  const id = `wardic-animate-${plainIds++}`
  const snapshot: Snapshot = emptySnapshotOf({})
  const spine = makeElementSpine({
    runtime: env.runtime,
    gate: env.gate,
    id,
    element: el,
    tag: undefined,
    config: () => NO_CONFIG,
    parent: undefined,
    canStart: undefined,
    extraDelay: undefined,
    onFrame: undefined,
    reducedMotion: env.reducedMotion,
    positionalKeys: env.positionalKeys,
    defaultTransition: env.defaultTransition,
    start: { initialValues: {}, initialLink: {}, startedLink: {}, quiet: false },
    snapshot,
    reuse: makeReuse(),
    links: startLinksOf(el, undefined, undefined),
    styleNow: undefined,
    live: undefined,
    presence: undefined,
    projected: false,
    dragAxis: undefined,
    handoff: undefined,
  })
  const plain: Plain = { spine, snapshot, id, running: 0, unregister: constVoid }
  byElement.set(element, plain)
  return plain
}

/**
 * `transition` with `skipAnimations` when its scope's animations are skipped (#468, Motion's
 * `useAnimate`, which hands its config's to each animation): a Wardic element's own config can skip it
 * too, and a plain element has none.
 */
const skippedIn = (env: AnimateEnv, transition: WardicTransition | undefined): WardicTransition | undefined => {
  if (Bool.not(env.skipAnimations())) return transition
  return { ...transition, skipAnimations: true } as WardicTransition
}

/**
 * An element's animation of `target`: through its spine when it's a Wardic element's, else through its
 * plain spine, in the gate while any of its animations runs.
 */
const trackOf = (env: AnimateEnv, element: Element, target: WardicVariant, given: WardicTransition | undefined, head: Playback.Playhead, settled: () => void): ImperativeTrack => {
  const resolved = resolveTarget(target, undefined, undefined, NO_VARIANT_STATE)
  const own = wardicElements.get(element)
  const hooks = { settled, failed: constVoid }
  const transition = skippedIn(env, given)
  if (Predicate.isNotUndefined(own)) return own.animate(resolved, transition, head, hooks)
  const plain = plainOf(env, element)
  // In the gate while it runs; out once its last animation is done, after the flush of its last frame.
  let live = false
  const enter = (): void => {
    if (live) return
    live = true
    // Back in the gate with every value it holds, so a transform it draws keeps the keys it isn't animating.
    if (plain.running === 0) {
      plain.unregister = env.gate.register(plain.id, { target: element })
      if (Bool.not(Rec.isEmptyRecord(plain.snapshot.values))) env.gate.write(plain.id, plain.snapshot.values)
    }
    plain.running++
  }
  const leave = (): void => {
    if (Bool.not(live)) return
    live = false
    plain.running--
    if (plain.running === 0) env.gate.afterFlush(() => {
      if (plain.running === 0) plain.unregister()
    })
  }
  const track = plain.spine.animate(resolved, transition, head, {
    settled: () => {
      leave()
      settled()
    },
    failed: () => leave(),
  })
  return {
    run: () => {
      enter()
      track.run()
    },
    stop: () => {
      track.stop()
      leave()
    },
    cancel: () => {
      enter()
      track.cancel()
      leave()
    },
    duration: track.duration,
  }
}

/** What `animate` animates: an element, a selector looked up inside the scope, or a list of elements. Motion's `ElementOrSelector`. */
export type WardicAnimationSubject = Element | string | ArrayLike<Element> | Iterable<Element> | null | undefined

/** A transition without its `delay`, each arm: `animate`'s and a Segment's take their own. */
type WithoutDelay = WardicTransition extends infer T ? (T extends unknown ? { readonly [K in keyof T as Exclude<K, "delay">]: T[K] } : never) : never

/** A `delay` that may be each element's (Motion's `delay(i, n)`; `stagger()` is #436). */
interface EachDelay {
  readonly delay?: number | ((index: number, count: number) => number) | undefined
}

/**
 * `animate`'s options: a transition, its `delay` a number, or a function of each element's index and
 * their count, such as `stagger(0.05)`; and `onComplete`, called as it lands. Motion's.
 */
export type WardicAnimateOptions = WithoutDelay & EachDelay & {
  readonly onComplete?: (() => void) | undefined
}

/** The elements of `subject`: a selector's inside `scope`, else the page's. */
const subjectsOf = (subject: WardicAnimationSubject, scope: Element | undefined): ReadonlyArray<Element> => {
  if (Predicate.isNullish(subject)) return []
  if (Predicate.isString(subject)) return Arr.fromIterable(UndefinedOr.match(scope, { onUndefined: () => document, onDefined: (el): ParentNode => el }).querySelectorAll(subject))
  if (Predicate.hasProperty(subject, "nodeType")) return [subject as Element]
  // A list's missing members left out, as Motion's.
  if (Predicate.isIterable(subject)) return Arr.filter(Arr.fromIterable(subject), Predicate.isNotNullish)
  const list = subject as ArrayLike<Element>
  return Arr.filter(Arr.makeBy(list.length, (i) => list[i] as Element), Predicate.isNotNullish)
}

/** A call's options without its `onComplete`: its transition. */
const withoutComplete = (given: WardicAnimateOptions): Readonly<Record<string, unknown>> => {
  const { onComplete: _onComplete, ...rest } = given as Readonly<Record<string, unknown>>
  return rest
}

/** Each element's transition: its `delay` worked out for it (Motion's `delay(i, n)`). */
const transitionFor = (options: WardicAnimateOptions | undefined, index: number, count: number): WardicTransition | undefined =>
  UndefinedOr.map(options, (given) => {
    const { delay, ...rest } = withoutComplete(given)
    if (Predicate.isFunction(delay)) return { ...rest, delay: (delay as (index: number, count: number) => number)(index, count) } as WardicTransition
    if (Predicate.isUndefined(delay)) return rest as WardicTransition
    return { ...rest, delay } as WardicTransition
  })

/** A Batch call's transition (#665): the options without `onComplete`, a `stagger()` delay kept for the Batch to count its movers. */
const batchTransitionOf = (options: WardicAnimateOptions | undefined): WardicTransition | undefined =>
  UndefinedOr.map(options, (given) => withoutComplete(given) as WardicTransition)

/** A call's transition for a Batch's members' elements: the call's, the target's own over it. */
const membersTransitionOf = (options: WardicAnimateOptions | undefined, target: WardicVariant): WardicTransition | undefined => {
  const call = batchTransitionOf(options)
  const own = (target as { readonly transition?: WardicTransition | undefined }).transition
  if (Predicate.isUndefined(own)) return call
  return { ...call, ...own } as WardicTransition
}

/** Whether a Batch call lands at once: its scope's animations are skipped, or its own `skipAnimations` (#468). */
const skipsBatchCall = (env: AnimateEnv, options: WardicAnimateOptions | undefined): boolean => {
  if (env.skipAnimations()) return true
  return UndefinedOr.match(options, { onUndefined: () => false, onDefined: (given) => given.skipAnimations === true })
}

/** Where an animation is: `"idle"`, `"running"`, `"paused"` or `"finished"`. Motion's `AnimationPlayState`. */
export type WardicPlayState = "idle" | "running" | "paused" | "finished"

/**
 * What `animate` returns: an animation's controls, and a promise of its landing, so it can be awaited.
 * Motion's `AnimationPlaybackControls`.
 */
// #433: every element's legs run through one Playhead.
export interface WardicPlaybackControls extends PromiseLike<void> {
  /** Seconds played, a delay included. Set, it seeks: each key starts again there, holding while paused. */
  time: number
  /** How fast it plays: 1 as given, 2 twice as fast, 0 held, below 0 backwards. */
  speed: number
  /** How long it runs, in seconds: its longest element's longest key, a spring's to rest. */
  readonly duration: number
  readonly state: WardicPlayState
  /** Resolves when it lands, or at `complete()`; never at `stop()` or `cancel()`, as Motion's. */
  readonly finished: Promise<void>
  /** Play it on: from where it's paused, or again from its start once it's finished or cancelled. Not after `stop()`. */
  readonly play: () => void
  /** Hold it where it is. */
  readonly pause: () => void
  /** End it where it is, for good: its keys stay there. */
  readonly stop: () => void
  /** End it, and put its keys back where it started them. */
  readonly cancel: () => void
  /** Go to its end at once, and finish. */
  readonly complete: () => void
}

/** What a scope hears of its animations: each one's start and its end, however it ended. */
export interface AnimationWatch {
  readonly started: (controls: WardicPlaybackControls) => void
  /** It's no longer in flight: `landed` when it finished. */
  readonly ended: (controls: WardicPlaybackControls, landed: boolean) => void
}

/** Playback controls over `tracks`, all run through `head`, started now. */
const controlsOf = (tracks: ReadonlyArray<ImperativeTrack>, head: Playback.Playhead, watch: AnimationWatch, onComplete: (() => void) | undefined): {
  readonly controls: WardicPlaybackControls
  readonly settledOne: () => void
} => {
  let state: WardicPlayState = "running"
  let stopped = false
  let landed = 0
  let resolve: (() => void) | undefined
  let finished: Promise<void> | undefined
  let isResolved = false
  let duration: number | undefined
  const durationNow = (): number => {
    if (Predicate.isUndefined(duration)) duration = Arr.reduce(tracks, 0, (longest, track) => Math.max(longest, track.duration()))
    return duration
  }
  const runAll = (): void => {
    landed = 0
    Arr.forEach(tracks, (track) => track.run())
  }
  const fresh = (): void => {
    finished = undefined
    resolve = undefined
    isResolved = false
  }
  const end = (how: WardicPlayState, landedNow: boolean): void => {
    const was = state
    state = how
    if (Bool.or(was === "running", was === "paused")) watch.ended(controls, landedNow)
  }
  const restart = (): void => {
    const was = state
    state = "running"
    if (Bool.or(was === "finished", was === "idle")) watch.started(controls)
  }
  const controls: WardicPlaybackControls = {
    get time() {
      return head.time
    },
    set time(at: number) {
      Playback.seek(head, at)
      // A seek of one that isn't running holds where it goes, as Motion's.
      if (state !== "running") {
        Playback.pause(head)
        if (Bool.or(state === "finished", state === "idle")) {
          fresh()
          watch.started(controls)
        }
        state = "paused"
      }
      runAll()
    },
    get speed() {
      return head.speed
    },
    set speed(speed: number) {
      Playback.setSpeed(head, speed)
    },
    get duration() {
      return durationNow()
    },
    get state() {
      return state
    },
    get finished() {
      if (Predicate.isUndefined(finished)) {
        finished = Bool.match(isResolved, {
          onTrue: () => Promise.resolve(),
          onFalse: () =>
            new Promise<void>((done) => {
              resolve = done
            }),
        })
      }
      return finished
    },
    then: (onResolve, onReject) => controls.finished.then(onResolve, onReject),
    play: () => {
      if (stopped) return
      if (state === "paused") {
        Playback.play(head)
        state = "running"
        return
      }
      if (state === "running") return
      // Again from its start: its end when it plays backwards.
      fresh()
      Playback.play(head)
      Playback.seek(head, Bool.match(head.speed < 0, { onTrue: durationNow, onFalse: () => 0 }))
      restart()
      runAll()
    },
    pause: () => {
      if (stopped) return
      Playback.pause(head)
      if (state === "running") state = "paused"
    },
    stop: () => {
      stopped = true
      Arr.forEach(tracks, (track) => track.stop())
      end("idle", false)
    },
    cancel: () => {
      Arr.forEach(tracks, (track) => track.cancel())
      Playback.seek(head, 0)
      end("idle", false)
    },
    complete: () => {
      if (stopped) return
      if (state !== "running") restart()
      Playback.play(head)
      Playback.seek(head, durationNow())
      runAll()
    },
  }
  // Each element's legs landed: the last lands the animation.
  const settledOne = (): void => {
    landed++
    if (landed < tracks.length) return
    isResolved = true
    UndefinedOr.map(resolve, (done) => done())
    UndefinedOr.map(onComplete, (complete) => complete())
    end("finished", true)
  }
  return { controls, settledOne }
}

/** An animation of no element: finished at once (a server's, or a subject that matched none). */
const finishedControls = (): WardicPlaybackControls => {
  const done = Promise.resolve()
  return {
    time: 0,
    speed: 1,
    duration: 0,
    state: "finished",
    finished: done,
    then: (onResolve, onReject) => done.then(onResolve, onReject),
    play: constVoid,
    pause: constVoid,
    stop: constVoid,
    cancel: constVoid,
    complete: constVoid,
  }
}

/**
 * Where a Segment starts in a sequence: seconds in, `1.5`; after or before the end of the Segment
 * before, `"+0.5"` or `"-0.5"`; at its start, `"<"`, or around it, `"<+0.5"` or `"<-0.5"`; or a label's
 * name. Motion's `SequenceTime`.
 */
export type WardicSequenceTime = number | "<" | `+${number}` | `-${number}` | `<+${number}` | `<-${number}` | (string & {})

/** A label in a sequence: a name for where the Segment before ends, or `{ name, at }` for a time of its own. Motion's. */
export type WardicSequenceLabel = string | { readonly name: string; readonly at: WardicSequenceTime }

/**
 * A Segment's options: a transition, with a value's own entries laid over it; its `delay`, a number or
 * a function of each element's index and count, such as `stagger(0.05)`; and `at`, where it starts. A
 * spring through two stops or fewer plays as an easing over its time to rest. Motion's.
 */
export type WardicSegmentOptions = WithoutDelay & EachDelay & {
  readonly at?: WardicSequenceTime | undefined
}

/** A Segment's values: each a value or a list of keyframes, as a target's. */
export type WardicSegmentTarget = Omit<WardicTargetValues, "transition">

/** A Segment of elements, `[subject, target, options?]`: an element, a selector inside the scope, or a list. Motion's. */
export type WardicElementSegment =
  | readonly [subject: WardicAnimationSubject, target: WardicSegmentTarget]
  | readonly [subject: WardicAnimationSubject, target: WardicSegmentTarget, options: WardicSegmentOptions]

/**
 * A function Segment, `[callback, value?, options?]`: its callback is given a value each frame, from 0
 * to 1 unless it gives its own stops, for what isn't an element's style. Motion's, in place of its
 * motion value Segments.
 */
export type WardicFunctionSegment =
  | readonly [callback: (value: number) => void]
  | readonly [callback: (value: number) => void, options: WardicSegmentOptions]
  | readonly [callback: (value: number) => void, value: number | WardicKeyframes<number>, options: WardicSegmentOptions]
  | readonly [callback: (value: string) => void, value: string | WardicKeyframes<string>, options: WardicSegmentOptions]

/** One step of a sequence: a label, a Segment of elements, or a function Segment. */
export type WardicSegment = WardicSequenceLabel | WardicElementSegment | WardicFunctionSegment

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
 * A sequence's options: `duration`, the whole sequence scaled to it; `delay`; `repeat`, `repeatType`
 * and `repeatDelay`; `defaultTransition`, each Segment's when it gives none (a 0.3 s `easeOut` tween
 * otherwise); and `onComplete`, called as it lands. Motion's `SequenceOptions`.
 */
export interface WardicSequenceOptions {
  readonly duration?: number | undefined
  readonly delay?: number | undefined
  readonly repeat?: number | undefined
  readonly repeatType?: "loop" | "reverse" | "mirror" | undefined
  readonly repeatDelay?: number | undefined
  readonly defaultTransition?: WardicTransition | undefined
  readonly onComplete?: (() => void) | undefined
}

/**
 * A scope's `animate`: `animate(subject, target, options?)` animates the subject's elements to
 * `target`, and `animate(sequence, options?)` plays a sequence. Either returns its playback controls.
 * Motion's `animate`, as `useAnimate` gives it.
 */
// #433: through one Playhead.
export interface WardicAnimate {
  (subject: WardicAnimationSubject, target: WardicVariant, options?: WardicAnimateOptions): WardicPlaybackControls
  (batch: WardicBatchSubject, target: WardicBatchTarget, options?: WardicAnimateOptions): WardicPlaybackControls
  (sequence: WardicAnimationSequence, options?: WardicSequenceOptions): WardicPlaybackControls
}

/**
 * An **Animation scope**'s `animate` (#433): selectors looked up inside `scope()`, each animation
 * told to `watch` as it starts and ends. Every element's legs start in the call, on the loop by
 * the end of its task.
 */
export const scopedAnimate = (env: AnimateEnv, scope: () => Element | undefined, watch: AnimationWatch): WardicAnimate =>
  ((first: WardicAnimationSubject | WardicAnimationSequence, second?: WardicVariant | WardicSequenceOptions, third?: WardicAnimateOptions): WardicPlaybackControls => {
    if (isSequence(first)) return sequenceOf(env, scope(), watch, first, second as WardicSequenceOptions | undefined)
    // A Batch, or a member's handle (#665): one track over its members, on the Batch's own run.
    const batch = batchSubjectOf(first)
    if (Predicate.isNotUndefined(batch)) {
      return started(watch, 1, UndefinedOr.map(third, (given) => given.onComplete), (head, settled) => [
        batch.binding.track({
          target: second as WardicBatchTarget,
          transition: batchTransitionOf(third),
          reducedMotion: env.reducedMotion(),
          skipAnimations: skipsBatchCall(env, third),
          head,
          settled,
          members: UndefinedOr.map(batch.member, (member) => [member]),
        }),
      ])
    }
    const elements = subjectsOf(first as WardicAnimationSubject, scope())
    const target = second as WardicVariant
    // A Batch's members' elements as one call over them, with its keys; the rest of each element's on its own (#665, Q14, Q35).
    const parts = callPartsOf(elements, target)
    return started(watch, parts.members.length + parts.elements.length, UndefinedOr.map(third, (given) => given.onComplete), (head, settled) => [
      ...Arr.map(parts.members, (part) =>
        part.binding.track({
          target: part.target,
          transition: membersTransitionOf(third, target),
          reducedMotion: env.reducedMotion(),
          skipAnimations: skipsBatchCall(env, third),
          head,
          settled,
          members: part.members,
        })),
      ...Arr.map(parts.elements, (part) => trackOf(env, part.element, part.target, transitionFor(third, part.index, elements.length), head, settled)),
    ])
  }) as WardicAnimate

/**
 * An animation of `count` tracks started (#433): its controls over them, through one Playhead, told
 * to `watch`, each track run. Finished at once with none.
 */
const started = (
  watch: AnimationWatch,
  count: number,
  onComplete: (() => void) | undefined,
  tracksOf: (head: Playback.Playhead, settled: () => void) => ReadonlyArray<ImperativeTrack>,
): WardicPlaybackControls => {
  if (count === 0) return finishedControls()
  const head = Playback.make()
  let settledOne = constVoid
  const tracks = tracksOf(head, () => settledOne())
  const made = controlsOf(tracks, head, watch, onComplete)
  settledOne = made.settledOne
  watch.started(made.controls)
  Arr.forEach(tracks, (track) => track.run())
  return made.controls
}

/** A server's `animate`: nothing to animate. */
export const serverAnimate: WardicAnimate = () => finishedControls()

// --- Sequences (#433's PR 2) ------------------------------------------------------------------

/** Whether `animate` was given a sequence (Motion's `isSequence`): a list with a Segment in it. */
const isSequence = (given: unknown): given is WardicAnimationSequence =>
  Bool.match(Arr.isArray(given), { onTrue: () => Arr.some(given as ReadonlyArray<unknown>, Arr.isArray), onFalse: () => false })

/** A function Segment's value (Motion's motion value): its own subject, its callback told each frame. */
interface Callback {
  readonly call: (value: number | string) => void
}

/** What a sequence animates: elements, and function Segments' values. */
type Subject = Element | Callback

/** Whether a subject is a function Segment's value. */
const isCallback = (subject: Subject): subject is Callback => Predicate.hasProperty(subject, "call")

/** The key a function Segment's value animates under. */
const VALUE = "value"

/** A function Segment's stops with none given (Motion's). */
const ZERO_TO_ONE: ReadonlyArray<number> = [0, 1]

/** No fields. */
const NO_FIELDS: Readonly<Record<string, unknown>> = {}

/**
 * What a Segment's transition doesn't take from the sequence's `defaultTransition` (Motion's): its
 * delay, times and repeat, which are each Segment's own, and a value's own transitions.
 */
const PLACING: ReadonlySet<string> = new Set(["delay", "times", "repeat", "repeatType", "repeatDelay", "reverse", "at"])

/** A Segment's default transition (Motion's): a 0.3 s `easeOut` tween. */
const SEGMENT_TWEEN: Sequence.Transition = { type: "tween" }

/** The fields of a sequence's options laid over each key's animation: `duration`, `delay` and the repeat. */
const WHOLE = ["duration", "delay", "repeat", "repeatType", "repeatDelay"] as const

/**
 * The fields of a sequence's `defaultTransition` laid over each key's animation, under its own
 * options' (Motion's): its delay and repeat. Its `duration` is a Segment's, never the sequence's.
 */
const WHOLE_DEFAULTS = ["delay", "repeat", "repeatType", "repeatDelay"] as const

/** `fields`' `keys`, those it has. */
const picked = (fields: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): Readonly<Record<string, unknown>> =>
  Rec.filter(fields, (value, key) => Bool.and(Arr.contains(keys, key), Predicate.isNotUndefined(value)))

/**
 * `key`'s transition in a Segment (Motion's `getValueTransition` for sequences): the Segment's,
 * the value's own laid over it, over the sequence's `defaultTransition` less its placing; a spring
 * or a tween as Wardic's transitions are (ADR-0051), Motion's 0.3 s `easeOut` tween when it defines
 * neither; its `delay` kept as given, each element's when it's a function.
 */
const segmentTransitionOf = (options: WardicSegmentOptions | undefined, key: string, defaults: WardicTransition | undefined): Sequence.Transition => {
  const own = UndefinedOr.match(options as Readonly<Record<string, unknown>> | undefined, {
    onUndefined: () => NO_FIELDS,
    onDefined: (given) => ({ ...given, ...UndefinedOr.match(given[key], { onUndefined: () => NO_FIELDS, onDefined: (entry) => Bool.match(Predicate.isObject(entry), { onTrue: () => entry as Readonly<Record<string, unknown>>, onFalse: () => NO_FIELDS }) }) }),
  })
  const base = UndefinedOr.match(defaults as Readonly<Record<string, unknown>> | undefined, {
    onUndefined: () => NO_FIELDS,
    onDefined: (given) => Rec.filter(given, (_, field) => Bool.not(PLACING.has(field))),
  })
  const { delay, at: _at, ...fields } = own
  // An inertia (#435) isn't a sequence's: a Segment's time is placed on its timeline, and a glide has none to place.
  const run = UndefinedOr.match(runOf({ ...base, ...fields } as WardicTransition), {
    onUndefined: () => SEGMENT_TWEEN,
    onDefined: (made) => Bool.match(made.type === "inertia", { onTrue: () => SEGMENT_TWEEN, onFalse: () => made as Sequence.Transition }),
  })
  return Bool.match(Predicate.isUndefined(delay), { onTrue: () => run, onFalse: () => ({ ...run, delay }) as Sequence.Transition })
}

/** Whether a Segment's value is one: a number, a string, `null` or Keyframes. */
const isSegmentValue: Predicate.Predicate<unknown> = Predicate.or(Predicate.or(Predicate.isNumber, Predicate.isString), Predicate.or(Predicate.isNull, Arr.isArray))

/** A Segment's values: those that are a value, `null` or Keyframes. */
const segmentValuesOf = (target: WardicSegmentTarget): Readonly<Record<string, Sequence.Stop | ReadonlyArray<Sequence.Stop>>> =>
  Rec.filter(target as Readonly<Record<string, unknown>>, isSegmentValue) as Readonly<Record<string, Sequence.Stop | ReadonlyArray<Sequence.Stop>>>

/** Each of `values`' keys' transition in a Segment. */
const segmentTransitionsOf = (values: Readonly<Record<string, unknown>>, options: WardicSegmentOptions | undefined, defaults: WardicTransition | undefined): Readonly<Record<string, Sequence.Transition>> =>
  Rec.map(values, (_, key) => segmentTransitionOf(options, key, defaults))

/** A Segment's `at`, when it gives one. */
const atOf = (options: WardicSegmentOptions | undefined): Sequence.Time | undefined => UndefinedOr.map(options, (given) => given.at)

/**
 * A sequence's steps for core (#433): labels as they are; an element Segment's elements (a selector
 * looked up once a sequence, inside `scope`), values and each value's transition; a function
 * Segment's own value, from 0 to 1 unless it gives its stops.
 */
const stepsOf = (sequence: WardicAnimationSequence, scope: Element | undefined, defaults: WardicTransition | undefined): ReadonlyArray<Sequence.Step<Subject>> => {
  const selected = new Map<string, ReadonlyArray<Element>>()
  const elementsOf = (subject: WardicAnimationSubject): ReadonlyArray<Element> => {
    if (Bool.not(Predicate.isString(subject))) return subjectsOf(subject, scope)
    const selector = subject as string
    const known = selected.get(selector)
    if (Predicate.isNotUndefined(known)) return known
    const found = subjectsOf(selector, scope)
    selected.set(selector, found)
    return found
  }
  return Arr.map(sequence, (segment): Sequence.Step<Subject> => {
    if (Predicate.isString(segment)) return segment
    if (Bool.not(Arr.isArray(segment))) return segment as { readonly name: string; readonly at: Sequence.Time }
    const parts = segment as ReadonlyArray<unknown>
    if (Predicate.isFunction(parts[0])) {
      const call = parts[0] as (value: number | string) => void
      const three = parts.length === 3
      const given = Bool.match(three, { onTrue: () => parts[1] as Sequence.Stop | ReadonlyArray<Sequence.Stop>, onFalse: () => ZERO_TO_ONE })
      const options = Bool.match(three, { onTrue: () => parts[2], onFalse: () => parts[1] }) as WardicSegmentOptions | undefined
      const target = { [VALUE]: given }
      return { subjects: [{ call }], target, transitions: segmentTransitionsOf(target, options, defaults), at: atOf(options) }
    }
    const [subject, values, options] = segment as WardicElementSegment
    const target = segmentValuesOf(values)
    return { subjects: elementsOf(subject), target, transitions: segmentTransitionsOf(target, options, defaults), at: atOf(options) }
  })
}

/**
 * A function Segment's value animated (#433): its stops, a first `null` 0, through the
 * Interpolators on its tween over the sequence, each frame told to its callback. Cancelled, the
 * callback hears its first stop again, as Motion's motion value is set back.
 */
const callbackTrackOf = (env: AnimateEnv, callback: Callback, animation: Sequence.Animation, head: Playback.Playhead, settled: () => void): ImperativeTrack => {
  const stops = filledStops(UndefinedOr.getOrThrow(animation.keyframes[VALUE]), 0)
  const options = UndefinedOr.getOrThrow(animation.transition[VALUE])
  // Skipped (#468): its callback told the value it would end on, on the first tick.
  const machine = Bool.match(env.skipAnimations(), {
    onTrue: () => Effect.succeed(ReducedMotion.snap<Values.Values>({ [VALUE]: UndefinedOr.getOrThrow(stops[0]) }, { [VALUE]: ReducedMotion.endOf(UndefinedOr.getOrThrow(stops[0]), UndefinedOr.getOrThrow(stops[stops.length - 1]), options) })),
    onFalse: () => Machine.keyframesValues({ [VALUE]: stops }, options),
  })
  let fiber: Fiber.Fiber<unknown> | undefined
  const end = (): void => {
    if (Predicate.isUndefined(fiber)) return
    const running = fiber
    fiber = undefined
    // Nothing waits on its end: interrupted here, not by a fiber forked for it (#618, L2).
    if (Predicate.isUndefined(running.pollUnsafe())) running.interruptUnsafe()
  }
  const landed = (exit: Exit.Exit<unknown>): Effect.Effect<void> =>
    Exit.match(exit, {
      onSuccess: () => Effect.sync(settled),
      onFailure: (cause) => Bool.match(Cause.hasInterruptsOnly(cause), { onTrue: () => Effect.void, onFalse: () => Report.failure("wardic.animate: a function Segment failed", cause) }),
    })
  const run = (): void => {
    end()
    fiber = env.runtime.runFork(
      machine.pipe(
        Effect.map(Playback.drive(head)),
        Effect.flatMap(Machine.run((frame) => {
          callback.call(UndefinedOr.getOrThrow(frame.value[VALUE]))
          return undefined
        })),
        Effect.onExit(landed),
      ),
    )
  }
  return {
    run,
    stop: end,
    cancel: () => {
      end()
      callback.call(UndefinedOr.getOrThrow(stops[0]))
    },
    duration: () => Machine.durationOf(env.runtime.runSync(machine)),
  }
}

/**
 * A sequence started (#433's PR 2, Motion's): compiled by core's `Sequence`, each element animated
 * through its Keyframes on its spine or its plain one, as a call animates it, and each function
 * Segment's value told to its callback; one Playhead for all, so it seeks, pauses and awaits as one.
 */
const sequenceOf = (env: AnimateEnv, scope: Element | undefined, watch: AnimationWatch, sequence: WardicAnimationSequence, options: WardicSequenceOptions | undefined): WardicPlaybackControls => {
  const defaults = UndefinedOr.map(options, (given) => given.defaultTransition)
  // The sequence's own options over its `defaultTransition`'s, as Motion's.
  const whole = {
    ...picked(UndefinedOr.match(defaults as Readonly<Record<string, unknown>> | undefined, { onUndefined: () => NO_FIELDS, onDefined: identity }), WHOLE_DEFAULTS),
    ...picked(UndefinedOr.match(options as Readonly<Record<string, unknown>> | undefined, { onUndefined: () => NO_FIELDS, onDefined: identity }), WHOLE),
  } as Sequence.Options
  const compiled = Arr.fromIterable(Sequence.compile(stepsOf(sequence, scope, defaults), whole))
  return started(watch, compiled.length, UndefinedOr.map(options, (given) => given.onComplete), (head, settled) =>
    Arr.map(compiled, ([subject, animation]) =>
      Match.value(subject).pipe(
        Match.when(isCallback, (callback) => callbackTrackOf(env, callback, animation, head, settled)),
        Match.orElse((element) => trackOf(env, element as Element, animation.keyframes as WardicVariant, animation.transition as WardicTransition, head, settled)),
      )))
}

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
  readonly animations: ReadonlyArray<WardicPlaybackControls>
}

/**
 * An Animation scope's ref and what it hears of its animations (#433): each in `animations` while in
 * flight, and `also` told too (Solid 2's `settled()`). `stopAll` stops them, at its owner's cleanup.
 */
export const scopeOf = <T extends Element>(also?: AnimationWatch): {
  readonly scope: WardicAnimationScope<T>
  readonly watch: AnimationWatch
  readonly stopAll: () => void
} => {
  let current: T | undefined
  // A set, and its array built only when `animations` is read, then kept until the set changes (#659):
  // an array copied at every start and every end made starting and ending n of them O(n²).
  const live = new Set<WardicPlaybackControls>()
  let listed: ReadonlyArray<WardicPlaybackControls> | undefined
  const animationsNow = (): ReadonlyArray<WardicPlaybackControls> => {
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
  const watch: AnimationWatch = {
    started: (controls) => {
      live.add(controls)
      listed = undefined
      UndefinedOr.map(also, (more) => more.started(controls))
    },
    ended: (controls, landed) => {
      live.delete(controls)
      listed = undefined
      UndefinedOr.map(also, (more) => more.ended(controls, landed))
    },
  }
  // Stopping one ends it, which deletes it from the set: safe in the set's own walk.
  return { scope, watch, stopAll: () => Iter.forEach(live, (controls) => controls.stop()) }
}
