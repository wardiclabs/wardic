/**
 * **Imperative animation** (#433, CONTEXT.md; Motion's `animate`), for every Environment: an
 * **Animation scope**'s `animate`, the Subjects it animates, and the **Playback controls** it returns.
 * An Environment says what its Subjects are and how a plain one starts ({@link Subjects}), and what
 * its Batches are ({@link Batches}); each binding's `createAnimate()` builds on it.
 *
 * - **A Wardic element** animates through its own spine, registered here while it's mounted: the
 *   call takes the keys it animates, which stay where it leaves them until the element's own target
 *   for them changes (Motion's latest-wins).
 * - **A plain Subject** animates through a spine of its own (#433's Q4), with no config, presence or
 *   layout node: it starts from the Subject's Own value (ADR-0022) and keeps its values for the next
 *   call, velocity included. It's in the gate only while it animates, so the gate keeps nothing of a
 *   Subject it isn't animating.
 * - **The controls** are Motion's (`AnimationPlaybackControls`): awaitable, with `stop`, `cancel`,
 *   `complete`, `pause`, `play`, `speed`, `time` and `duration`, every Subject's legs run through one
 *   `Playback.Playhead`. Its `finished` resolves at a landing or `complete()`, never at a `stop()` or a
 *   `cancel()`, as Motion's.
 * - **A sequence** (#433's PR 2, Motion's) is compiled by core's `Sequence` to each Subject's
 *   Keyframes over the whole sequence, run on the same controls: each Subject animates as a call
 *   does, and a function Segment's value, from 0, is told to its callback each frame.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #882 (ADR-0073, *Amendment (#882)*, Q1): dom's `unstable/Imperative`
// (#672's move of solid's `imperative.ts`), its environment-agnostic part moved here behind two ports, so
// `@wardic/object` animates plain objects with no DOM code; dom fills the ports with its elements,
// selectors and Batch members.
import type * as DefaultTransition from "../DefaultTransition.ts"
import type * as Frame from "../Frame.ts"
import * as InterpolatorRegistry from "../InterpolatorRegistry.ts"
import * as Machine from "../Machine.ts"
import * as Playback from "../Playback.ts"
import * as ReducedMotion from "../ReducedMotion.ts"
import * as Sequence from "../Sequence.ts"
import type * as Values from "../Values.ts"
import type * as Config from "./Config.ts"
import type * as FlushGate from "./FlushGate.ts"
import type * as MeasuredPairs from "./MeasuredPairs.ts"
import type * as OwnValues from "./OwnValues.ts"
import * as Report from "./Report.ts"
import * as RetargetLegs from "./RetargetLegs.ts"
import * as Spine from "./Spine.ts"
import type * as VariableValues from "./VariableValues.ts"
import * as VariantTarget from "./VariantTarget.ts"
import * as VariantTree from "./VariantTree.ts"
import type * as WardicServices from "./WardicServices.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import { constTrue, constVoid, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"

/** What an Imperative animation animates a Wardic element through: what its spine hands over (`host`). */
type Animatable = Pick<Spine.ElementSpine, "host">

/** Each mounted Wardic element's spine (Motion's `visualElementStore`), by its Subject. */
// Module state (#460, Q7): each Wardic element's animatable, held weakly by its Subject.
const wardicElements = new WeakMap<object, Animatable>()

/**
 * Register a mounted Wardic element's spine for the Imperative animations of its Subject (#433): until
 * the returned function, which its unmount calls.
 */
export const registerAnimatable = (subject: object, spine: Animatable): (() => void) => {
  wardicElements.set(subject, spine)
  return () => {
    if (wardicElements.get(subject) === spine) wardicElements.delete(subject)
  }
}

/** What a scope animates plain Subjects with: its provider's. */
export interface AnimateEnv {
  readonly runtime: WardicServices.Runner<WardicServices.WardicServices>
  readonly gate: FlushGate.Shape
  readonly reducedMotion: () => boolean
  /**
   * Whether its animations are skipped (#468): its scope's nearest `WardicConfig`'s, read as each
   * starts, and handed to each Subject's animation in its transition, as Motion's `useAnimate` does.
   */
  readonly skipAnimations: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
  /** Its Environment's reads of its Subjects' own values (#672). */
  readonly ownValues: OwnValues.Shape
  /** Its Environment's Measured pairs (#430, #672). */
  readonly measuredPairs: MeasuredPairs.Shape
  /** Its Environment's Variable values (#55, #672). */
  readonly variableValues: VariableValues.Shape
}

/**
 * An Environment's Subjects, for `animate`: what its first argument names, and where a plain one
 * starts. The DOM's are elements, selectors looked up in the scope and lists of them; a scene's, its
 * objects.
 */
export interface Subjects<S extends object> {
  /** The Subjects `given` names, inside `scope` (a binding's scope, or `undefined`): none when it names none. */
  readonly resolve: (given: unknown, scope: unknown) => ReadonlyArray<S>
  /** A plain Subject's Base-value links (ADR-0022): its Own values, and the DOM's Starting style. */
  readonly startLinksOf: (subject: S) => Spine.StartLinks
}

/** What `animate` asks of a Batch's binding (#665): its tracks, and its Segments in a sequence. */
// Methods, not properties: a binding's own calls take its Environment's targets, a narrower type.
export interface BatchCalls {
  /** An `animate` call's track over its members, or the members `members` names, driven by `head`. */
  track(call: BatchCall): Spine.ImperativeTrack
  /** The members a Batch or a member's handle names: `undefined` for every member, none once a handle's member has left. */
  namedOf(entry: BatchEntry): ReadonlyArray<number> | undefined
  /** A sequence's Segment of the Batch, or of the members `named` names: its members' entries, in member order, and its values for core. */
  segmentOf(named: ReadonlyArray<number> | undefined, target: Readonly<Record<string, unknown>>): {
    readonly subjects: ReadonlyArray<BatchMember>
    readonly values: Readonly<Record<string, Sequence.Value>>
  }
  /** A sequence's track over its members, each through its own Batch keys' stops, driven by `head`. */
  sequenceTrack(call: BatchSequenceCall): Spine.ImperativeTrack
}

/** What `animate` knows of a Batch or a member's handle: its binding, and a handle's member by its index. */
export interface BatchEntry {
  readonly binding: BatchCalls
  readonly member: number | undefined
}

/** A member's entry: a member's handle's, or a member's Subject's. */
export interface BatchMember extends BatchEntry {
  readonly member: number
}

/** An `animate` call of a Batch: its targets, its transition, its scope's settings, its Playhead and landing. */
export interface BatchCall {
  readonly target: Readonly<Record<string, unknown>>
  readonly transition: Config.WardicTransition | undefined
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
  readonly head: Playback.Playhead
  readonly settled: () => void
  /** It ended with a key a later change took, never landing (#951). */
  readonly taken: () => void
  /** The members it moves, in order: every member when left out. */
  readonly members: ReadonlyArray<number> | undefined
}

/** A sequence's part for a Batch: its members, in order, each one's compiled animation, its scope's settings, its Playhead and landing. */
export interface BatchSequenceCall {
  readonly members: ReadonlyArray<number>
  readonly animations: ReadonlyArray<Sequence.Animation>
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
  readonly head: Playback.Playhead
  readonly settled: () => void
  /** It ended with a key a later change took, never landing (#951). */
  readonly taken: () => void
}

/** An `animate` call's parts for Subjects that are Batch members' (#665): each Batch's members, and each Subject's own keys. */
export interface CallParts<S extends object> {
  readonly members: ReadonlyArray<{ readonly binding: BatchCalls; readonly members: ReadonlyArray<number>; readonly target: Readonly<Record<string, unknown>> }>
  readonly subjects: ReadonlyArray<{ readonly subject: S; readonly index: number; readonly target: object }>
}

/** A compiled sequence's part for one Batch: its members, in the order they first appear, and each one's animation. */
export interface SequencePart {
  readonly binding: BatchCalls
  readonly members: ReadonlyArray<number>
  readonly animations: ReadonlyArray<Sequence.Animation>
}

/** An Environment's Batches, for `animate`: its handles, and the Subjects that are its members'. */
// Methods, as `BatchCalls`' are: an Environment's entries carry its own binding, a wider type.
export interface Batches<S extends object> {
  /** The Batch or member handle `given` is: `undefined` for anything else. */
  entryOf(given: unknown): BatchEntry | undefined
  /** Whether any of `subjects` is a Batch member's: when none is, a call keeps the plain path. */
  hasMembers(subjects: ReadonlyArray<S>): boolean
  /** A call's parts, when some of `subjects` are members': each Batch's members as one part, with its keys. */
  callPartsOf(subjects: ReadonlyArray<S>, target: object): CallParts<S>
  /** A Segment's subjects: each member's as its member's entry, each Batch checking the Segment's values once. */
  segmentSubjectsOf(subjects: ReadonlyArray<S>, target: Readonly<Record<string, unknown>>): ReadonlyArray<S | BatchMember>
  /** A compiled sequence's parts: each Batch's members as one part, the other keys of a member's its Subject's. */
  sequencePartsOf<X>(compiled: ReadonlyArray<readonly [X | BatchMember, Sequence.Animation]>): {
    readonly batches: ReadonlyArray<SequencePart>
    readonly others: ReadonlyArray<readonly [X | S, Sequence.Animation]>
  }
}

/** An Environment with no Batches. */
export const noBatches: Batches<object> = {
  entryOf: () => undefined,
  hasMembers: () => false,
  callPartsOf: (subjects, target) => ({ members: [], subjects: Arr.map(subjects, (subject, index) => ({ subject, index, target })) }),
  segmentSubjectsOf: identity,
  sequencePartsOf: (compiled) => ({ batches: [], others: compiled as ReadonlyArray<readonly [never, Sequence.Animation]> }),
}

/** What `animate` works with: its Environment's Subjects and Batches. */
export interface Ports<S extends object> {
  readonly subjects: Subjects<S>
  readonly batches: Batches<S>
}

/** A plain Subject's spine (#433's Q4), its values, and how many of its animations run, which keep it in the gate. */
interface Plain {
  readonly spine: Spine.ElementSpine
  readonly snapshot: Spine.Snapshot
  readonly id: string
  running: number
  unregister: () => void
}

/** Each gate's plain Subjects: a provider's own, kept while the Subject is. */
// Module state (#460, Q7): each gate's plain Subjects, held weakly by the gate.
const plainByGate = new WeakMap<FlushGate.Shape, WeakMap<object, Plain>>()

/** The plain Subjects' gate ids, counted. */
// Module state (#460, Q7): an id counter, unique across every gate.
let plainIds = 0

/** No config: a plain Subject's. */
const NO_CONFIG = {}

/** `subject`'s plain spine under `env`'s gate, made at its first animation. */
const plainOf = <S extends object>(env: AnimateEnv, subjects: Subjects<S>, subject: S): Plain => {
  let bySubject = plainByGate.get(env.gate)
  if (Predicate.isUndefined(bySubject)) {
    bySubject = new WeakMap()
    plainByGate.set(env.gate, bySubject)
  }
  const known = bySubject.get(subject)
  if (Predicate.isNotUndefined(known)) return known
  const id = `wardic-animate-${plainIds++}`
  const snapshot: Spine.Snapshot = Spine.emptySnapshotOf({})
  const spine = Spine.makeElementSpine({
    runtime: env.runtime,
    gate: env.gate,
    id,
    element: subject,
    tag: undefined,
    config: () => NO_CONFIG,
    parent: undefined,
    canStart: undefined,
    extraDelay: undefined,
    onFrame: undefined,
    reducedMotion: env.reducedMotion,
    positionalKeys: env.positionalKeys,
    defaultTransition: env.defaultTransition,
    ownValues: env.ownValues,
    measuredPairs: env.measuredPairs,
    variableValues: env.variableValues,
    start: { initialValues: {}, initialLink: {}, startedLink: {}, quiet: false },
    snapshot,
    reuse: Spine.makeReuse(),
    links: subjects.startLinksOf(subject),
    styleNow: undefined,
    live: undefined,
    presence: undefined,
    projected: false,
    dragAxis: undefined,
    handoff: undefined,
  })
  const plain: Plain = { spine, snapshot, id, running: 0, unregister: constVoid }
  bySubject.set(subject, plain)
  return plain
}

/**
 * `transition` with `skipAnimations` when its scope's animations are skipped (#468, Motion's
 * `useAnimate`, which hands its config's to each animation): a Wardic element's own config can skip it
 * too, and a plain Subject has none.
 */
const skippedIn = (env: AnimateEnv, transition: Config.WardicTransition | undefined): Config.WardicTransition | undefined => {
  if (Bool.not(env.skipAnimations())) return transition
  return { ...transition, skipAnimations: true } as Config.WardicTransition
}

/**
 * The resolution an **Imperative animation**'s legs run under (#433): none of the Override stack's,
 * so a Retarget that takes a key back never carries one as its own Keyframes or names.
 */
const IMPERATIVE: Spine.Resolution = {
  resolved: {},
  base: {},
  dragging: false,
  variant: undefined,
  active: { inView: false, focused: false, hovered: false, pressed: false, dragged: false, dragging: false },
  transition: undefined,
  layers: [],
  names: VariantTree.NO_GESTURE_NAMES,
  layersOn: VariantTree.NO_GESTURE_STATES,
  ends: undefined,
  keyframes: undefined,
  change: undefined,
}

/** The target the Override stack had for each key at the spine's last Retarget: what a taken key is noted with. */
const lastTargetsOf = (host: Spine.SpineHost): Values.Values => UndefinedOr.match(host.lastResolution(), { onUndefined: () => Spine.NO_VALUES, onDefined: (last) => last.resolved })

/**
 * `key` taken by an Imperative animation from whatever runs it (#433): noted in `taking` with `noted`,
 * the target the Override stack has for it now, no longer returning, its Timeline value stopped, given
 * up by its owner, owned, and started where it's drawn toward `like`, noted in `started`.
 */
const takeKey = (host: Spine.SpineHost, taking: Map<string, number | string | undefined>, key: string, noted: number | string | undefined, like: number | string, started: Record<string, string>): void => {
  taking.set(key, noted)
  host.returning().delete(key)
  // Its Timeline value stops while the animation draws the key (#240).
  const timelineKeys = host.timelineKeys()
  if (Predicate.isNotUndefined(timelineKeys)) timelineKeys.taken(key)
  const owner = host.owners.get(key)
  if (Predicate.isNotUndefined(owner)) host.giveUp(key, owner)
  if (!Object.hasOwn(host.initialValues, key)) host.ownValue(key)
  host.startKey(key, like, started)
}

/** Whether a Transition end may set a key drawn by `owner`: none draws it, or its leg is done. */
const endFree = (owner: Spine.Running | undefined): boolean => {
  if (Predicate.isUndefined(owner)) return true
  return owner.done
}

/**
 * An **Imperative animation** of a Subject (#433), through its spine's `host`: it takes `target`'s
 * keys from whatever runs them, each noted with the target the Override stack has for it now, so a
 * Retarget leaves it where the animation leaves it until that target changes (Motion's latest-wins).
 * Its legs start where the keys are drawn, with their velocity, on `given` (a key with none of its own
 * on its Default transition), reduced motion as the provider says, and run through `head` once
 * {@link Spine.ImperativeTrack.run} is called. Once they land, none taken, its target's Transition
 * end is set (#896), and put back by a cancel or a run again.
 */
// #746 (ADR-0067, *Amendment (#746)*, decision 10): here, not in the spine, so an app that never animates
// imperatively ships none of it; the spine hands over what it takes (`SpineHost`).
const imperativeTrackOf = (host: Spine.SpineHost, target: VariantTarget.Target, given: Config.WardicTransition | undefined, head: Playback.Playhead, hooks: Spine.ImperativeHooks): Spine.ImperativeTrack => {
  const { snapshot, owners, keepTheRest, element, positionalKeys, defaultTransition, unitScale, readVelocity, gate, forget, endLeg, live, own, legProgram, legEnded, turnBack, id, recordFrame, runtime, elementRules, measuredPairs, variableValues } = host
  /** A leg of an Imperative animation, forked as a Retarget's are; it lands on its track. */
  // Data-first: a pipe's curried forms are two closures more for every leg (#618, H1).
  const runImperative = (running: Spine.Running, program: Effect.Effect<unknown, never, WardicServices.WardicServices>): void => {
    const at = runs
    running.fiber = runtime.runFork(Effect.asVoid(Effect.onExit(program, (exit) => {
      if (at === runs) supersededAt(running)
      return legEnded(running)(exit)
    })))
  }
  const to = target.values
  const before = lastTargetsOf(host)
  const started: Record<string, string> = {}
  let measuring: Array<string> | undefined
  // Each key taken from whatever runs it, noted with its target now, and started where it's drawn.
  // Its velocity read now (#464), as its legs are built.
  const takenNow = host.taking()
  // Where a Path's axis this target leaves out rests (#574), before its keys are taken below.
  const rests = Spine.restsOf(owners, to)
  Arr.forEach(Rec.keys(to), (key) => {
    const like = UndefinedOr.getOrThrow(to[key])
    takeKey(host, takenNow, key, before[key], like, started)
    if (measuredPairs.needs(key, UndefinedOr.getOrThrow(snapshot.values[key]), like)) {
      if (Predicate.isUndefined(measuring)) measuring = []
      measuring.push(key)
    }
  })
  keepTheRest()
  let from: Values.Values = Rec.map(to, (_, key) => UndefinedOr.getOrThrow(snapshot.values[key]))
  let stops: RetargetLegs.StopsByKey | undefined
  if (Predicate.isNotUndefined(target.keyframes)) {
    const begun = RetargetLegs.keyframesFrom(from, to, target.keyframes)
    from = begun.from
    stops = begun.stops
  }
  const reduce = host.reducedMotion()
  const skipped = host.skipAnimations()
  let measured: RetargetLegs.MeasuredPairs | undefined
  if (Bool.and(Bool.not(Bool.or(reduce, skipped)), Predicate.isNotUndefined(measuring))) measured = Spine.measuredOf(measuredPairs, element, UndefinedOr.getOrThrow(measuring), from, to, snapshot.values, stops)
  // Built once: a seek or a replay runs the same legs, from the same start, with the same velocities.
  const built = RetargetLegs.legsOf(from, to, given, reduce, skipped, positionalKeys, defaultTransition, readVelocity, undefined, stops, measured, snapshot.values, rests, unitScale)
  const variables = Spine.holdsVariable(variableValues, from, to, stops)
  const legs = Arr.map(built, (leg) => RetargetLegs.mapMachine(leg, Playback.drive(head)))
  let runnings: ReadonlyArray<Spine.Running> = Spine.NO_RUNNING
  let left = 0
  const ends = target.transitionEnd
  // What its Transition end's keys were before it set them (Q5): `undefined` until it has.
  let overwritten: Values.Values | undefined
  // Its runs, stops and cancels, counted: what a landing waiting on a flush checks it's still for.
  let runs = 0
  // `values` drawn at once, at rest: newer than the legs that let them go (#464).
  const setAtRest = (values: Values.Values): void => {
    snapshot.values = { ...snapshot.values, ...values }
    snapshot.velocities = { ...snapshot.velocities, ...Rec.map(values, () => 0) }
    const now = snapshot.now()
    Arr.forEach(Rec.keys(values), (key) => {
      snapshot.drawnAt[key] = now
    })
    gate.write(id, values)
    recordFrame(values)
  }
  /**
   * Its **Transition end** set (#896, ADR-0061 *Amendment (#896)*, Q2 and Q4): each key no leg draws
   * now taken as the keys it animates are, started where it's drawn, then set at once.
   */
  // Each of `values`' keys `only` picks taken as the call took its own (`takeKey`), noted with the
  // Override stack's targets now: an end's keys as it's set, a run's again as it starts (#951).
  const takeEach = (values: Values.Values, only: (key: string) => boolean): void => {
    const takingNow = host.taking()
    const targetsNow = lastTargetsOf(host)
    const startedNow: Record<string, string> = {}
    Arr.forEach(Rec.keys(values), (key) => {
      if (only(key)) takeKey(host, takingNow, key, targetsNow[key], UndefinedOr.getOrThrow(values[key]), startedNow)
    })
  }
  const writeEnds = (values: Values.Values): void => {
    const free = Rec.filter(values, (_, key) => endFree(owners.get(key)))
    if (Rec.isEmptyRecord(free)) return
    takeEach(free, constTrue)
    // Kept from an earlier landing a run from its end didn't put back: what they were before any.
    if (Predicate.isUndefined(overwritten)) overwritten = Rec.map(free, (_, key) => UndefinedOr.getOrThrow(snapshot.values[key]))
    setAtRest(free)
  }
  /**
   * Its Transition end's keys put back as they were before it was set (Q5): at a cancel, a seek or a
   * replay, each a key no leg has drawn since, a later call's or the element's own. The next landing
   * sets them again.
   */
  const putBack = (): void => {
    if (Predicate.isUndefined(overwritten)) return
    // Its take left each without an owner: one since is a later animation's, which wins.
    const back = Rec.filter(overwritten, (_, key) => Predicate.isUndefined(owners.get(key)))
    overwritten = undefined
    if (Bool.not(Rec.isEmptyRecord(back))) setAtRest(back)
  }
  // Whether its `i`th leg snaps (#468's skip, reduced motion's positional keys): it lands on its next
  // frame, its keys landed from its start, so a take before then takes nothing in flight, as Motion's
  // skipped value makes no animation. Its machine read only for a leg that lost a key.
  const snaps = (i: number): boolean => Machine.durationOf(machineOf(UndefinedOr.getOrThrow(built[i]))) === 0
  // A leg the element's own Retarget carried on, toward the same target, as its own (Q7): the call has lost it.
  let carried = false
  // Taken (#896's Q3, #951): a key it animates taken from its leg mid-flight, by a later animation or the
  // element's own target, or a leg carried off whole. A leg that lost one has fewer than it started
  // with; one taken after its leg landed doesn't count, as Motion's, nor one that snaps.
  const taken = (): boolean => {
    if (carried) return true
    return Arr.some(runnings, (running, i) => Bool.and(running.count < Rec.size(running.targets), Bool.not(snaps(i))))
  }
  // Landed: its Transition end set at the flush after its last leg's frame, then the landing told
  // after the flush that draws it, so the landing includes it (ADR-0057 decision 4). Taken, it ends
  // without landing, its end dropped, as Motion's call never resolves (ADR-0061 *Amendment (#951)*).
  // A run, a stop or a cancel since makes each wait stale: a take reported synchronously, then a seek
  // in the same task, or a stop between its end and its landing, tells none.
  const landed = (): void => {
    const at = runs
    if (taken()) {
      return gate.afterFlush(() => {
        if (at === runs) hooks.settled(false)
      })
    }
    if (Predicate.isUndefined(ends)) {
      return gate.afterFlush(() => {
        if (at === runs) hooks.settled(true)
      })
    }
    gate.afterFlush(() => {
      if (at !== runs) return
      writeEnds(ends)
      gate.afterFlush(() => {
        if (at === runs) hooks.settled(true)
      })
    })
  }
  // A leg landed, or was Superseded (#951): the last lands the track, or finds it taken.
  const legDone = (): void => {
    left--
    if (left === 0) landed()
  }
  const landing: Spine.Landing = {
    report: constVoid,
    settled: legDone,
    failed: hooks.failed,
  }
  /**
   * A leg of this run ended **Superseded** (#951), told at its end, as it settles nothing of this
   * track's: carried on by the element's own Retarget as its own, its landing the Retarget's now (Q7);
   * or with every key taken, a count of 0 (only a take lowers it), which `taken` reads. Either counts
   * toward the track's landing, which finds it taken.
   */
  // Here, not in the spine, so an app with no Imperative animation pays nothing for it.
  const supersededAt = (running: Spine.Running): void => {
    if (running.landing !== landing) {
      carried = true
      return legDone()
    }
    if (running.count === 0) legDone()
  }
  // Its legs ended where they are: the keys they draw are drawn by none.
  const end = (): void =>
    Arr.forEach(runnings, (running) => {
      forget(running)
      if (Bool.not(running.done)) endLeg(running)
    })
  // Whether a run starts at its end, going forward, its end set: it lands at once, so its end stays,
  // with no frame without it (a seek to the end, `complete()`). Its duration read only then.
  const fromItsEnd = (): boolean => {
    if (Predicate.isUndefined(overwritten)) return false
    if (head.speed < 0) return false
    return head.time >= duration()
  }
  // A key another leg draws: a later animation's, or the element's own.
  const drawnByAnother = (key: string): boolean => Predicate.isNotUndefined(owners.get(key))
  const run = (): void => {
    runs++
    end()
    carried = false
    // Run again, it takes each of its keys from whatever draws it now, as the call took them (#951): one
    // leg draws a key. The first run's are taken already.
    if (runs > 1) takeEach(to, drawnByAnother)
    if (Bool.not(fromItsEnd())) putBack()
    left = legs.length
    Spine.tellStarted(live, legs)
    runnings = Arr.map(legs, (leg) => {
      const running = Spine.runningOf(leg.to, IMPERATIVE, landing, leg._tag)
      own(running)
      runImperative(running, legProgram(leg, running, variables))
      return running
    })
    // A target with no key lands at once.
    if (left === 0) landed()
  }
  const cancel = (): void => {
    runs++
    end()
    turnBack()
    putBack()
    // Put back at once, its keys where it started them.
    setAtRest(from)
  }
  // Each leg's machine, run from its start to rest, apart from the Playhead, which it would move: a
  // blend's built with the Subject's Key rules.
  const duration = (): number =>
    Arr.reduce(built, 0, (longest, leg) => Math.max(longest, Machine.durationOf(machineOf(leg))))
  const machineOf = (leg: RetargetLegs.Leg): Machine.Machine<Frame.Frame<unknown>> => {
    if (leg._tag === "Blend") return runtime.runSync(Effect.suspend(leg.machine).pipe(InterpolatorRegistry.withKeyRules(elementRules)))
    return leg.machine() as Machine.Machine<Frame.Frame<unknown>>
  }
  const stop = (): void => {
    runs++
    end()
    turnBack()
  }
  return { run, stop, cancel, duration }
}

/**
 * A call's transition on its target's own (#896, ADR-0061 *Amendment (#896)*, Q1): the options' fields
 * laid over the target's, shallowly, as `inherit: true` lays a target's over its element's. Motion's
 * `animate` reads the options alone.
 */
// Its own handed back as it is with no options, so the legs' decode cache (#66) holds for it. Its
// `inherit` has nothing above it in a call: the legs read none (`RetargetLegs`' `NOT_DEFINING`).
const overOwn = (own: Config.WardicVariantTransition | undefined, given: Config.WardicTransition | undefined): Config.WardicTransition | undefined => {
  if (Predicate.isUndefined(own)) return given
  if (Predicate.isUndefined(given)) return own as Config.WardicTransition
  return { ...own, ...given } as Config.WardicTransition
}

/**
 * A Subject's animation of `target`: through its spine when it's a Wardic element's, else through its
 * plain spine, in the gate while any of its animations runs.
 */
const trackOf = <S extends object>(env: AnimateEnv, subjects: Subjects<S>, subject: S, target: Config.WardicVariant, given: Config.WardicTransition | undefined, head: Playback.Playhead, settled: (landed: boolean) => void): Spine.ImperativeTrack => {
  const resolved = VariantTarget.resolveTarget(target, undefined, undefined, VariantTarget.NO_VARIANT_STATE)
  const own = wardicElements.get(subject)
  const hooks = { settled, failed: constVoid }
  const transition = skippedIn(env, overOwn(resolved.transition, given))
  if (Predicate.isNotUndefined(own)) return imperativeTrackOf(own.host(), resolved, transition, head, hooks)
  const plain = plainOf(env, subjects, subject)
  // In the gate while it runs; out once its last animation is done, after the flush of its last frame.
  let live = false
  const enter = (): void => {
    if (live) return
    live = true
    // Back in the gate with every value it holds, so a transform it draws keeps the keys it isn't animating.
    if (plain.running === 0) {
      plain.unregister = env.gate.register(plain.id, { target: subject })
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
  const track = imperativeTrackOf(plain.spine.host(), resolved, transition, head, {
    settled: (landed) => {
      leave()
      settled(landed)
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

/** A transition without its `delay`, each arm: `animate`'s and a Segment's take their own. */
type WithoutDelay = Config.WardicTransition extends infer T ? (T extends unknown ? { readonly [K in keyof T as Exclude<K, "delay">]: T[K] } : never) : never

/** A `delay` that may be each Subject's (Motion's `delay(i, n)`; `stagger()` is #436). */
interface EachDelay {
  readonly delay?: number | ((index: number, count: number) => number) | undefined
}

/**
 * `animate`'s options: a transition, laid field by field over the target's own, its `delay` a number,
 * or a function of each Subject's index and their count, such as `stagger(0.05)`; and `onComplete`,
 * called as it lands, each Subject's `transitionEnd` already set. Motion's, though Motion's `animate`
 * runs on the options alone.
 */
export type WardicAnimateOptions = WithoutDelay & EachDelay & {
  readonly onComplete?: (() => void) | undefined
}

/** A call's options without its `onComplete`: its transition. */
const withoutComplete = (given: WardicAnimateOptions): Readonly<Record<string, unknown>> => {
  const { onComplete: _onComplete, ...rest } = given as Readonly<Record<string, unknown>>
  return rest
}

/** Each Subject's transition: its `delay` worked out for it (Motion's `delay(i, n)`). */
const transitionFor = (options: WardicAnimateOptions | undefined, index: number, count: number): Config.WardicTransition | undefined =>
  UndefinedOr.map(options, (given) => {
    const { delay, ...rest } = withoutComplete(given)
    if (Predicate.isFunction(delay)) return { ...rest, delay: (delay as (index: number, count: number) => number)(index, count) } as Config.WardicTransition
    if (Predicate.isUndefined(delay)) return rest as Config.WardicTransition
    return { ...rest, delay } as Config.WardicTransition
  })

/** A Batch call's transition (#665): the options without `onComplete`, a `stagger()` delay kept for the Batch to count its movers. */
const batchTransitionOf = (options: WardicAnimateOptions | undefined): Config.WardicTransition | undefined =>
  UndefinedOr.map(options, (given) => withoutComplete(given) as Config.WardicTransition)

/** A Batch call's track over `members` (every member when left out), driven by `head`: the call's options its transition. */
const batchTrackOf = (env: AnimateEnv, binding: BatchCalls, target: Readonly<Record<string, unknown>>, members: ReadonlyArray<number> | undefined, options: WardicAnimateOptions | undefined, head: Playback.Playhead, settled: (landed: boolean) => void): Spine.ImperativeTrack =>
  binding.track({
    target,
    transition: batchTransitionOf(options),
    reducedMotion: env.reducedMotion(),
    skipAnimations: skipsBatchCall(env, options),
    head,
    settled: () => settled(true),
    taken: () => settled(false),
    members,
  })

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
// #433: every Subject's legs run through one Playhead.
export interface WardicPlaybackControls extends PromiseLike<void> {
  /** Seconds played, a delay included. Set, it seeks: each key starts again there, holding while paused. */
  time: number
  /** How fast it plays: 1 as given, 2 twice as fast, 0 held, below 0 backwards. */
  speed: number
  /** How long it runs, in seconds: its longest Subject's longest key, a spring's to rest. */
  readonly duration: number
  /**
   * Where it is: `"running"`, `"paused"`, `"finished"` once it lands, and `"idle"` after `stop()` or
   * `cancel()`, or once a later animation has taken one of its keys and the rest have landed.
   */
  readonly state: WardicPlayState
  /**
   * Resolves when it lands, or at `complete()`; never at `stop()` or `cancel()`, nor once a later
   * animation takes one of its keys, as Motion's.
   */
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
const controlsOf = (tracks: ReadonlyArray<Spine.ImperativeTrack>, head: Playback.Playhead, watch: AnimationWatch, onComplete: (() => void) | undefined): {
  readonly controls: WardicPlaybackControls
  readonly settledOne: (landed: boolean) => void
} => {
  let state: WardicPlayState = "running"
  let stopped = false
  let landed = 0
  // Whether a Subject's part ended without landing, a key of it taken by a later animation (#951).
  let anyTaken = false
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
    anyTaken = false
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
  // Each Subject's legs landed, or ended with a key taken: the last lands the animation, or, with one
  // taken, ends it without landing, as a stop does (#951, Q1 and Q5). Motion's never resolves then.
  const settledOne = (landedOne: boolean): void => {
    landed++
    if (Bool.not(landedOne)) anyTaken = true
    if (landed < tracks.length) return
    if (anyTaken) {
      stopped = true
      return end("idle", false)
    }
    isResolved = true
    UndefinedOr.map(resolve, (done) => done())
    UndefinedOr.map(onComplete, (complete) => complete())
    end("finished", true)
  }
  return { controls, settledOne }
}

/** An animation of no Subject: finished at once (a server's, or a subject that matched none). */
export const finishedControls = (): WardicPlaybackControls => {
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
 * a function of each Subject's index and count, such as `stagger(0.05)`; and `at`, where it starts. A
 * spring through two stops or fewer plays as an easing over its time to rest. Motion's.
 */
export type WardicSegmentOptions = WithoutDelay & EachDelay & {
  readonly at?: WardicSequenceTime | undefined
}

/** A Segment's values: each a value or a list of keyframes, as a target's. */
export type WardicSegmentTarget = Omit<Config.WardicTargetValues, "transition">

/**
 * A function Segment, `[callback, value?, options?]`: its callback is given a value each frame, from 0
 * to 1 unless it gives its own stops, for what isn't a Subject's own value. Motion's, in place of its
 * motion value Segments.
 */
export type WardicFunctionSegment =
  | readonly [callback: (value: number) => void]
  | readonly [callback: (value: number) => void, options: WardicSegmentOptions]
  | readonly [callback: (value: number) => void, value: number | Config.WardicKeyframes<number>, options: WardicSegmentOptions]
  | readonly [callback: (value: string) => void, value: string | Config.WardicKeyframes<string>, options: WardicSegmentOptions]

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
  readonly defaultTransition?: Config.WardicTransition | undefined
  readonly onComplete?: (() => void) | undefined
}

/**
 * An animation of `count` tracks started (#433): its controls over them, through one Playhead, told
 * to `watch`, each track run. Finished at once with none.
 */
const started = (
  watch: AnimationWatch,
  count: number,
  onComplete: (() => void) | undefined,
  tracksOf: (head: Playback.Playhead, settled: (landed: boolean) => void) => ReadonlyArray<Spine.ImperativeTrack>,
): WardicPlaybackControls => {
  if (count === 0) return finishedControls()
  const head = Playback.make()
  let settledOne: (landed: boolean) => void = constVoid
  const tracks = tracksOf(head, (landedOne) => settledOne(landedOne))
  const made = controlsOf(tracks, head, watch, onComplete)
  settledOne = made.settledOne
  watch.started(made.controls)
  Arr.forEach(tracks, (track) => track.run())
  return made.controls
}

/**
 * An **Animation scope**'s `animate` (#433), over an Environment's {@link Ports}: `animate(subject,
 * target, options?)`, a Batch's `animate(batch, target, options?)` and `animate(sequence, options?)`,
 * each returning its Playback controls. `scope()` is handed to the Environment's {@link Subjects.resolve}
 * (the DOM's selectors are looked up inside it); each animation is told to `watch` as it starts and
 * ends. Every Subject's legs start in the call, on the loop by the end of its task. An Environment
 * types its own overloads over it.
 */
export const make = <S extends object>(env: AnimateEnv, ports: Ports<S>, scope: () => unknown, watch: AnimationWatch) =>
  (first: unknown, second?: unknown, third?: WardicAnimateOptions): WardicPlaybackControls => {
    if (isSequence(first)) return sequenceOf(env, ports, scope(), watch, first, second as WardicSequenceOptions | undefined)
    // A Batch, or a member's handle (#665): one track over its members, on the Batch's own run.
    const batch = ports.batches.entryOf(first)
    if (Predicate.isNotUndefined(batch)) {
      const members = batch.binding.namedOf(batch)
      return started(watch, 1, UndefinedOr.map(third, (given) => given.onComplete), (head, settled) => [
        batchTrackOf(env, batch.binding, second as Readonly<Record<string, unknown>>, members, third, head, settled),
      ])
    }
    const subjects = ports.subjects.resolve(first, scope())
    const target = second as Config.WardicVariant
    const onComplete = UndefinedOr.map(third, (given) => given.onComplete)
    // No member's Subject among them: each Subject's track, building no parts (bench:solid --batch's
    // per-element page, a call per element: 8.2 -> 8.5 ms at 1,000 with the parts built for every call; #665).
    if (Bool.not(ports.batches.hasMembers(subjects))) {
      return started(watch, subjects.length, onComplete, (head, settled) =>
        Arr.map(subjects, (subject, index) => trackOf(env, ports.subjects, subject, target, transitionFor(third, index, subjects.length), head, settled)))
    }
    // A Batch's members' Subjects as one call over them, with its keys; the rest of each Subject's on its own (#665, Q14, Q35).
    const parts = ports.batches.callPartsOf(subjects, target)
    return started(watch, parts.members.length + parts.subjects.length, onComplete, (head, settled) => [
      ...Arr.map(parts.members, (part) => batchTrackOf(env, part.binding, part.target, part.members, third, head, settled)),
      ...Arr.map(parts.subjects, (part) => trackOf(env, ports.subjects, part.subject, part.target as Config.WardicVariant, transitionFor(third, part.index, subjects.length), head, settled)),
    ])
  }

// --- Sequences (#433's PR 2) ------------------------------------------------------------------

/** Whether `given` is a sequence rather than a subject (#433, Motion's `isSequence`): a list with a Segment, itself a list, in it; a list of Subjects has none. A binding whose `animate` is its own tells the forms apart by it (#798). */
export const isSequence = (given: unknown): given is ReadonlyArray<unknown> =>
  Bool.match(Arr.isArray(given), { onTrue: () => Arr.some(given as ReadonlyArray<unknown>, Arr.isArray), onFalse: () => false })

/** A function Segment's value (Motion's motion value): its own subject, its callback told each frame. */
interface Callback {
  readonly call: (value: number | string) => void
}

/** Whether a sequence's subject is a function Segment's value. */
const isCallback = (subject: unknown): subject is Callback => Predicate.hasProperty(subject, "call")

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
 * neither; its `delay` kept as given, each Subject's when it's a function.
 */
const segmentTransitionOf = (options: WardicSegmentOptions | undefined, key: string, defaults: Config.WardicTransition | undefined): Sequence.Transition => {
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
  const run = UndefinedOr.match(RetargetLegs.runOf({ ...base, ...fields } as Config.WardicTransition), {
    onUndefined: () => SEGMENT_TWEEN,
    onDefined: (made) => Bool.match(made.type === "inertia", { onTrue: () => SEGMENT_TWEEN, onFalse: () => made as Sequence.Transition }),
  })
  return Bool.match(Predicate.isUndefined(delay), { onTrue: () => run, onFalse: () => ({ ...run, delay }) as Sequence.Transition })
}

/** Whether a Segment's value is one: a number, a string, `null` or Keyframes. */
const isSegmentValue: Predicate.Predicate<unknown> = /*#__PURE__*/ Predicate.or(/*#__PURE__*/ Predicate.or(Predicate.isNumber, Predicate.isString), /*#__PURE__*/ Predicate.or(Predicate.isNull, Arr.isArray))

/** A Segment's values: those that are a value, `null` or Keyframes. */
const segmentValuesOf = (target: WardicSegmentTarget): Readonly<Record<string, Sequence.Stop | ReadonlyArray<Sequence.Stop>>> =>
  Rec.filter(target as Readonly<Record<string, unknown>>, isSegmentValue) as Readonly<Record<string, Sequence.Stop | ReadonlyArray<Sequence.Stop>>>

/** Each of `values`' keys' transition in a Segment. */
const segmentTransitionsOf = (values: Readonly<Record<string, unknown>>, options: WardicSegmentOptions | undefined, defaults: Config.WardicTransition | undefined): Readonly<Record<string, Sequence.Transition>> =>
  Rec.map(values, (_, key) => segmentTransitionOf(options, key, defaults))

/** A Segment's `at`, when it gives one. */
const atOf = (options: WardicSegmentOptions | undefined): Sequence.Time | undefined => UndefinedOr.map(options, (given) => given.at)

/**
 * A Segment's subjects (#665, Q40): each Subject, a member's as its member's entry, so its Batch keys
 * run in its Batch, as one subject with the member a Segment of the Batch names.
 */
const subjectsIn = <S extends object>(batches: Batches<S>, subjects: ReadonlyArray<S>, target: Readonly<Record<string, unknown>>): ReadonlyArray<S | BatchMember> => {
  if (Bool.not(batches.hasMembers(subjects))) return subjects
  return batches.segmentSubjectsOf(subjects, target)
}

/**
 * A sequence's steps for core (#433): labels as they are; a Segment of Subjects' Subjects (a string
 * the Environment resolves, a DOM selector, looked up once a sequence, inside `scope`), values and each
 * value's transition; a function Segment's own value, from 0 to 1 unless it gives its stops.
 */
const stepsOf = <S extends object>(ports: Ports<S>, sequence: ReadonlyArray<unknown>, scope: unknown, defaults: Config.WardicTransition | undefined): ReadonlyArray<Sequence.Step<S | Callback | BatchMember>> => {
  const named = new Map<string, ReadonlyArray<S>>()
  const subjectsOf = (subject: unknown): ReadonlyArray<S> => {
    if (Bool.not(Predicate.isString(subject))) return ports.subjects.resolve(subject, scope)
    const name = subject as string
    const known = named.get(name)
    if (Predicate.isNotUndefined(known)) return known
    const found = ports.subjects.resolve(name, scope)
    named.set(name, found)
    return found
  }
  return Arr.map(sequence, (segment): Sequence.Step<S | Callback | BatchMember> => {
    if (Predicate.isString(segment)) return segment
    if (Bool.not(Arr.isArray(segment))) return segment as { readonly name: string; readonly at: Sequence.Time }
    const parts = segment as ReadonlyArray<unknown>
    // A Batch, or a member's handle (#665, Q38, Q39): its members, each through its own stops in the Batch.
    const batch = ports.batches.entryOf(parts[0])
    if (Predicate.isNotUndefined(batch)) {
      const options = parts[2] as WardicSegmentOptions | undefined
      const { subjects, values } = batch.binding.segmentOf(batch.binding.namedOf(batch), parts[1] as Readonly<Record<string, unknown>>)
      return { subjects, target: values, transitions: segmentTransitionsOf(values, options, defaults), at: atOf(options) }
    }
    if (Predicate.isFunction(parts[0])) {
      const call = parts[0] as (value: number | string) => void
      const three = parts.length === 3
      const given = Bool.match(three, { onTrue: () => parts[1] as Sequence.Stop | ReadonlyArray<Sequence.Stop>, onFalse: () => ZERO_TO_ONE })
      const options = Bool.match(three, { onTrue: () => parts[2], onFalse: () => parts[1] }) as WardicSegmentOptions | undefined
      const target = { [VALUE]: given }
      return { subjects: [{ call }], target, transitions: segmentTransitionsOf(target, options, defaults), at: atOf(options) }
    }
    const [subject, values, options] = segment as readonly [unknown, WardicSegmentTarget, WardicSegmentOptions | undefined]
    const target = segmentValuesOf(values)
    return { subjects: subjectsIn(ports.batches, subjectsOf(subject), target), target, transitions: segmentTransitionsOf(target, options, defaults), at: atOf(options) }
  })
}

/**
 * Whether a Segment animates anything under `scope` (#798): a function Segment does, and a Batch's; a
 * Segment of Subjects when its subject names one; a label (a string, or `{ name, at }`) never. What a
 * binding asks of a sequence before it plays it, since one that animates nothing lands at once.
 */
export const segmentAnimates = <S extends object>(ports: Ports<S>, segment: unknown, scope: unknown): boolean => {
  if (Predicate.isString(segment)) return false
  if (Bool.not(Arr.isArray(segment))) return false
  const parts = segment as ReadonlyArray<unknown>
  if (Predicate.isNotUndefined(ports.batches.entryOf(parts[0]))) return true
  if (Predicate.isFunction(parts[0])) return true
  return ports.subjects.resolve(parts[0], scope).length > 0
}

/**
 * A function Segment's value animated (#433): its stops, a first `null` 0, through the
 * Interpolators on its tween over the sequence, each frame told to its callback. Cancelled, the
 * callback hears its first stop again, as Motion's motion value is set back.
 */
const callbackTrackOf = (env: AnimateEnv, callback: Callback, animation: Sequence.Animation, head: Playback.Playhead, settled: (landed: boolean) => void): Spine.ImperativeTrack => {
  const stops = RetargetLegs.filledStops(UndefinedOr.getOrThrow(animation.keyframes[VALUE]), 0)
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
      onSuccess: () => Effect.sync(() => settled(true)),
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
 * A sequence started (#433's PR 2, Motion's): compiled by core's `Sequence`, each Subject animated
 * through its Keyframes on its spine or its plain one, as a call animates it, and each function
 * Segment's value told to its callback; one Playhead for all, so it seeks, pauses and awaits as one.
 */
const sequenceOf = <S extends object>(env: AnimateEnv, ports: Ports<S>, scope: unknown, watch: AnimationWatch, sequence: ReadonlyArray<unknown>, options: WardicSequenceOptions | undefined): WardicPlaybackControls => {
  const defaults = UndefinedOr.map(options, (given) => given.defaultTransition)
  // The sequence's own options over its `defaultTransition`'s, as Motion's.
  const whole = {
    ...picked(UndefinedOr.match(defaults as Readonly<Record<string, unknown>> | undefined, { onUndefined: () => NO_FIELDS, onDefined: identity }), WHOLE_DEFAULTS),
    ...picked(UndefinedOr.match(options as Readonly<Record<string, unknown>> | undefined, { onUndefined: () => NO_FIELDS, onDefined: identity }), WHOLE),
  } as Sequence.Options
  const compiled = Arr.fromIterable(Sequence.compile(stepsOf(ports, sequence, scope, defaults), whole))
  // Each Batch's members as one track, their other keys their Subjects' (#665, Q40).
  const parts = ports.batches.sequencePartsOf<S | Callback>(compiled)
  return started(watch, compiled.length, UndefinedOr.map(options, (given) => given.onComplete), (head, settled) => [
    ...Arr.map(parts.others, ([subject, animation]) => {
      if (isCallback(subject)) return callbackTrackOf(env, subject, animation, head, settled)
      return trackOf(env, ports.subjects, subject as S, animation.keyframes as Config.WardicVariant, animation.transition as Config.WardicTransition, head, settled)
    }),
    ...Arr.map(parts.batches, (part) =>
      part.binding.sequenceTrack({ members: part.members, animations: part.animations, reducedMotion: env.reducedMotion(), skipAnimations: env.skipAnimations(), head, settled: () => settled(true), taken: () => settled(false) })),
  ])
}

/** `watch`, with `also` told each start and end after it, when given: a scope's own watch beside its owner's (#433), a binding's beside a scope's (#798). */
export const alsoTold = (watch: AnimationWatch, also: AnimationWatch | undefined): AnimationWatch =>
  UndefinedOr.match(also, {
    onUndefined: () => watch,
    onDefined: (more) => ({
      started: (controls) => {
        watch.started(controls)
        more.started(controls)
      },
      ended: (controls, landed) => {
        watch.ended(controls, landed)
        more.ended(controls, landed)
      },
    }),
  })
