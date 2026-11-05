/**
 * The pointer's drags and pans. `drag` is a Stream of `Drag.Sample`s as a pointer drags `target`, kept
 * to its axis, and refused when another element holds that axis; `pan` gives the same samples with a
 * session's start at each down, moves nothing, and stops no drag. `watchDrag` and `watchPan` call you
 * with each sample inside its pointer event's dispatch while a Scope is open, with no fiber of their own:
 * a binding's drags run on these. They're apart from `Recognizer`'s gestures, so an app that never drags
 * ships none of this.
 *
 * @example
 * import * as DragRecognizer from "@wardic/core/DragRecognizer"
 *
 * yield* DragRecognizer.watchDrag(card, { axis: "x" }, {
 *   on: (sample) => {
 *     if (sample.phase === "end") fling(sample.velocity.x)
 *     else moveTo(sample.offset.x)
 *   },
 * })
 */
// #548, ADR-0067 *Amendment (#548)*: apart from `Recognizer`, so a page that drags ships it with that
// page. `drag` and `pan` share one fold: a gesture's owner, its threshold, and its velocity over the last
// 100 ms. The watches are #318's (ADR-0055); the Streams are built over them. Tier 2 (ADR-0008), for
// binding authors.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constant, constTrue, constVoid, identity, type LazyArg } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Drag from "./Drag.ts"
import * as DragActivity from "./DragActivity.ts"
import * as InputFeed from "./InputFeed.ts"
import * as InputSource from "./InputSource.ts"
import type * as Point from "./Point.ts"
import * as Velocity from "./Velocity.ts"

import { streamOf, watchFeed } from "./internal/watch.ts"

/**
 * Movement distance (px) from the down-origin required before a gesture
 * activates. Below this the pointer is treated as a tap-in-progress and no
 * samples are emitted; crossing it promotes the gesture to `"start"`.
 */
const THRESHOLD = 3

/**
 * Width (ms) of the trailing window a sample's velocity is read over: Motion's `getVelocity`'s
 * (`Velocity.trailing`; ADR-0004, *Amendment (#139)*), so moves more than a frame or two apart
 * still have a velocity.
 */
const VELOCITY_WINDOW_MS = 100

interface DragState {
  readonly phase: "idle" | "active"
  readonly ownerId: number | null
  /** How far (px) the gesture moves from its origin before it starts, read at its down (#431). */
  readonly threshold: number
  readonly origin: Point.Point
  readonly last: Point.Point
  /** The scroll counted into `last` (#257): a sample at `last` carries it. */
  readonly lastScroll: Point.Point
  /** The platform event `last` came with (#431): a gesture ended from outside its pointer carries it. */
  readonly lastRaw: unknown
  readonly history: ReadonlyArray<Velocity.TimedPoint>
}

const initState: DragState = {
  phase: "idle",
  ownerId: null,
  threshold: THRESHOLD,
  origin: { x: 0, y: 0 },
  last: { x: 0, y: 0 },
  lastScroll: InputSource.NO_SCROLL,
  lastRaw: undefined,
  history: [],
}

/** Euclidean distance between two points. */
const dist = (a: Point.Point, b: Point.Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The gesture's history with `point` added, oldest first, keeping what `Velocity.trailing`
 * reads: the press point, the newest point older than the window, and every point inside it.
 * It reads as the whole gesture's history would, the skip of a stale press point included.
 */
const pushHistory = (
  history: ReadonlyArray<Velocity.TimedPoint>,
  point: Velocity.TimedPoint,
): ReadonlyArray<Velocity.TimedPoint> => {
  const points = Arr.append(history, point)
  const cutoff = point.timeStamp - VELOCITY_WINDOW_MS
  return Option.match(Arr.findLastIndex(points, (p) => p.timeStamp < cutoff), {
    onNone: () => points,
    onSome: (older) => Arr.filter(points, (_, i) => i === 0 || i >= older),
  })
}

/** Per-axis velocity (units/sec) over the history's last 100 ms (`Velocity.trailing`, Motion's `getVelocity`). */
const windowVelocity = (history: ReadonlyArray<Velocity.TimedPoint>): Point.Point =>
  Velocity.trailing(history, VELOCITY_WINDOW_MS)

/** Why a Stale gesture ended: its owner moved with no button pressed (rule A), or went down again (rule B). */
type StaleRule = "unpressed move" | "second down"

/**
 * The `"end"` samples that close a Stale gesture, and why (read by {@link drag}'s
 * cold-path log). A WeakMap, so the fold stays pure and allocates nothing more.
 */
const staleEnds = /*#__PURE__*/ new WeakMap<Drag.Sample, StaleRule>()

/** No samples: the event changes nothing a consumer sees. */
const NO_SAMPLES: ReadonlyArray<Drag.Sample> = []

/**
 * The end of a Stale gesture: an `"end"` at its last pressed point, with no delta and
 * no velocity (a lost release carries no Fling). A gesture that never started (below
 * the threshold) just resets and emits nothing.
 */
const staleEnd = (state: DragState, rule: StaleRule, timeStamp: number, raw: unknown): ReadonlyArray<Drag.Sample> =>
  Bool.match(state.phase === "active", {
    onFalse: () => NO_SAMPLES,
    onTrue: () => {
      const sample: Drag.Sample = {
        point: state.last,
        offset: { x: state.last.x - state.origin.x, y: state.last.y - state.origin.y },
        delta: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        phase: "end",
        timeStamp,
        scroll: state.lastScroll,
        raw,
        axis: "xy",
      }
      staleEnds.set(sample, rule)
      return [sample]
    },
  })

/** A gesture claimed by `event`, a down, which starts once it moves `threshold` px. */
const claimedBy = (event: InputSource.PointerLikeEvent, point: Point.Point, threshold: number): DragState => ({
  phase: "idle",
  ownerId: event.pointerId,
  threshold,
  origin: point,
  last: point,
  lastScroll: event.scroll,
  lastRaw: event.raw,
  history: [{ x: point.x, y: point.y, timeStamp: event.timeStamp }],
})

/** One fold step: the next state, and the samples it emits. */
type Step = readonly [DragState, ReadonlyArray<Drag.Sample>]

/** An event the drag ignores: the state as it was, and no samples. */
const ignored = (state: DragState): Step => [state, NO_SAMPLES]

/** The event's pointer position. */
const pointOf = (event: InputSource.PointerLikeEvent): Point.Point => ({ x: event.x, y: event.y })

/**
 * Which downs a fold claims a gesture from, and how far (px) each gesture moves before it starts
 * (#431): a drag's own presses unless it doesn't listen to them, and the downs it adopted; a pan's
 * own presses alone.
 */
interface Downs {
  readonly claims: (down: InputSource.PointerLikeEvent) => boolean
  readonly thresholdOf: (down: InputSource.PointerLikeEvent) => number
}

/** Whether `down` was adopted (#431, `InputSource.adoptPointer`). */
const isAdopted = (down: InputSource.PointerLikeEvent): boolean => down.adopted === true

/** A pan's downs: the target's own presses, each starting past the threshold. */
const OWN_DOWNS: Downs = { claims: (down) => Bool.not(isAdopted(down)), thresholdOf: () => THRESHOLD }

/**
 * A down: one it claims claims a free gesture, and the owner's second down ends its lost one (rule B);
 * one it doesn't claim is left out, as the same press adopted after its own down is (#431).
 */
const onDown = (state: DragState, event: InputSource.PointerLikeEvent, downs: Downs): Step => {
  if (Bool.not(downs.claims(event))) return ignored(state)
  const point = pointOf(event)
  return Option.match(Option.fromNullOr(state.ownerId), {
    onNone: () => [claimedBy(event, point, downs.thresholdOf(event)), NO_SAMPLES],
    onSome: (owner) =>
      Bool.match(event.pointerId === owner, {
        // Rule B: the owner went down again, so its release was lost.
        onTrue: () => [claimedBy(event, point, downs.thresholdOf(event)), staleEnd(state, "second down", event.timeStamp, event.raw)],
        // Another pointer while one owns the gesture — ignore.
        onFalse: () => ignored(state),
      }),
  })
}

/**
 * The owner's release or cancel: an active gesture emits its final `"end"`; a release before
 * the threshold is a tap and emits nothing. Either way the state resets.
 */
const onRelease = (state: DragState, event: InputSource.PointerLikeEvent): Step =>
  Bool.match(state.phase === "active", {
    onFalse: () => [initState, NO_SAMPLES],
    onTrue: () => {
      // A cancel's coordinates aren't the pointer's (Chromium's pointercancel carries
      // (0, 0)), so it ends at the last move's point, with the moves' velocity, as
      // Motion's pan session does (PanSession.ts:329-333 at 16c6122).
      const sample: Drag.Sample = Bool.match(event.type === "cancel", {
        onTrue: () => ({
          point: state.last,
          offset: { x: state.last.x - state.origin.x, y: state.last.y - state.origin.y },
          delta: { x: 0, y: 0 },
          velocity: windowVelocity(state.history),
          phase: "end",
          timeStamp: event.timeStamp,
          scroll: state.lastScroll,
          raw: event.raw,
          axis: "xy",
        }),
        onFalse: () => {
          const point = pointOf(event)
          // The release point counts: a pause before letting go weakens the throw (ADR-0004, *Amendment (#139)*).
          const history = pushHistory(state.history, { x: point.x, y: point.y, timeStamp: event.timeStamp })
          return {
            point,
            offset: { x: point.x - state.origin.x, y: point.y - state.origin.y },
            delta: { x: point.x - state.last.x, y: point.y - state.last.y },
            velocity: windowVelocity(history),
            phase: "end",
            timeStamp: event.timeStamp,
            scroll: event.scroll,
            raw: event.raw,
            axis: "xy",
          }
        },
      })
      return [initState, [sample]]
    },
  })

/** Whether `state`'s gesture, moved to `point`, has started: a rule of {@link stepOf}. */
type Starts = (state: DragState, point: Point.Point) => boolean

/** A drag's: past its threshold, in any direction. */
const pastThreshold: Starts = (state, point) => dist(state.origin, point) > state.threshold

/**
 * Motion's direction lock threshold (`getCurrentDirection`'s `lockThreshold`, px): a direction-locked
 * drag starts once its offset passes it on one axis (#273, ADR-0047).
 */
const LOCK_THRESHOLD = 10

/** A direction-locked gesture's axis from its offset: y past the lock threshold first, then x, as Motion's; none below it. */
const lockOf = (offset: Point.Point): "x" | "y" | undefined => {
  if (Math.abs(offset.y) > LOCK_THRESHOLD) return "y"
  if (Math.abs(offset.x) > LOCK_THRESHOLD) return "x"
  return undefined
}

/** A direction-locked drag's: past its threshold, and past the lock threshold on one axis. */
const locks: Starts = (state, point) =>
  Bool.and(pastThreshold(state, point), Predicate.isNotUndefined(lockOf({ x: point.x - state.origin.x, y: point.y - state.origin.y })))

/** The owner's move: before the gesture `starts` it primes the history; starting emits "start"; then every move emits. */
const onMove = (state: DragState, event: InputSource.PointerLikeEvent, starts: Starts): Step => {
  const point = pointOf(event)
  const history = pushHistory(state.history, { x: point.x, y: point.y, timeStamp: event.timeStamp })
  const offset: Point.Point = { x: point.x - state.origin.x, y: point.y - state.origin.y }
  const delta: Point.Point = { x: point.x - state.last.x, y: point.y - state.last.y }
  const lastScroll = event.scroll
  const lastRaw = event.raw
  const sample = (phase: Drag.Sample["phase"]): Drag.Sample => ({
    point,
    offset,
    delta,
    velocity: windowVelocity(history),
    phase,
    timeStamp: event.timeStamp,
    scroll: lastScroll,
    raw: event.raw,
    axis: "xy",
  })
  return Match.value(state.phase).pipe(
    Match.when("idle", (): Step =>
      Bool.match(starts(state, point), {
        // Starting promotes the gesture and emits "start".
        onTrue: (): Step => [{ ...state, phase: "active", last: point, lastScroll, lastRaw, history }, [sample("start")]],
        // Not yet: keep origin fixed, advance last/history so velocity is primed, but suppress output.
        onFalse: (): Step => [{ ...state, last: point, lastScroll, lastRaw, history }, NO_SAMPLES],
      }),
    ),
    // Active: every move emits.
    Match.when("active", (): Step => [{ ...state, last: point, lastScroll, lastRaw, history }, [sample("move")]]),
    Match.exhaustive,
  )
}

/**
 * The gesture ended from outside its pointer (#431, Motion's drag controls): an `"end"` at its last
 * point, with that event's time and platform event, as a cancel's. `stop`'s has the moves' velocity,
 * a release; `cancel`'s none, marked `cancelled`. A gesture that hasn't started resets with no sample,
 * as a tap does. Either way its pointer's later events are left out, until a down claims again.
 */
const endedFromOutside = (state: DragState, cancelled: boolean): Step =>
  Bool.match(state.phase === "active", {
    onFalse: (): Step => [initState, NO_SAMPLES],
    onTrue: (): Step => {
      const end: Drag.Sample = {
        point: state.last,
        offset: { x: state.last.x - state.origin.x, y: state.last.y - state.origin.y },
        delta: { x: 0, y: 0 },
        velocity: Bool.match(cancelled, { onTrue: () => ({ x: 0, y: 0 }), onFalse: () => windowVelocity(state.history) }),
        phase: "end",
        timeStamp: Option.match(Arr.last(state.history), { onNone: () => 0, onSome: (p) => p.timeStamp }),
        scroll: state.lastScroll,
        raw: state.lastRaw,
        axis: "xy",
      }
      return [initState, [Bool.match(cancelled, { onTrue: (): Drag.Sample => ({ ...end, cancelled: true }), onFalse: () => end })]]
    },
  })

/** An event from the gesture's owner, other than a down. */
const onOwner = (state: DragState, event: InputSource.PointerLikeEvent, starts: Starts): Step =>
  Match.value(event).pipe(
    // Rule A: the owner moved with no button pressed, so its release was lost.
    Match.when({ type: "move", pressed: false }, (e): Step => [initState, staleEnd(state, "unpressed move", e.timeStamp, e.raw)]),
    // Release / cancel from the owner: emit final "end", reset.
    Match.when({ type: Match.is("up", "cancel") }, (e) => onRelease(state, e)),
    // Movement from the owner.
    Match.when({ type: "move" }, (e) => onMove(state, e, starts)),
    // "enter"/"leave" and anything else: no-op for drag.
    Match.orElse(() => ignored(state)),
  )

/**
 * A fold of one pointer event into the drag state, emitting zero or more samples, for a gesture
 * that `starts` as it says, from the `downs` it claims (#431).
 *
 * Only the **Primary pointer** counts (Motion's `InputSource.isPrimaryPointer`): a right-click or a
 * second finger is ignored. Zero-or-more output: activation/sub-threshold/non-owner
 * events emit `[]`; threshold crossing emits one `"start"`; subsequent moves emit one
 * `"move"`; release/cancel emits one `"end"`. A Stale gesture (ADR-0019) ends at the
 * owner's move with `buttons === 0` (rule A) or its next down (rule B, which then
 * claims the new gesture): see {@link staleEnd}. Runs once per pointer event, not per frame
 * (ADR-0025); no logging here.
 */
const stepOf = (starts: Starts, downs: Downs) => (state: DragState, event: InputSource.PointerLikeEvent): Step =>
  Match.value(event).pipe(
    Match.when(Predicate.not(InputSource.isPrimaryPointer), () => ignored(state)),
    // --- Activation: a "down" claims the gesture. ---
    Match.when({ type: "down" }, (down) => onDown(state, down, downs)),
    // No owner yet, or an event from a non-owning pointer — ignore.
    Match.orElse((e) =>
      Bool.match(e.pointerId === state.ownerId, { onTrue: () => onOwner(state, e, starts), onFalse: () => ignored(state) }),
    ),
  )

/** A pan's fold: its own presses, each starting past the threshold. */
const panFold = /*#__PURE__*/ stepOf(pastThreshold, OWN_DOWNS)

/** `drag`'s and `watchDrag`'s options. */
// ADR-0019, *Amendment (#29)*.
export interface DragOptions {
  /**
   * The axes the drag moves on, and claims: `"xy"` by default. A one-axis drag's samples have their other
   * axis's `offset`, `delta` and `velocity` at 0; `point` and `phase` are left as they are. A function is
   * read at each gesture's start and holds to its end, as a Reorder item's axis is decided per gesture.
   */
  // ADR-0020.
  readonly axis?: Drag.Axis | LazyArg<Drag.Axis> | undefined
  /**
   * `false`: the drag claims no axis and is never refused, as Motion's `dragPropagation`. It still counts
   * as an active drag, so no hover or press starts while it's on. Default `true`.
   */
  // A **Drag claim**; the **Drag activity**.
  readonly claim?: boolean | undefined
  /**
   * A direction lock, as Motion's `dragDirectionLock`: the gesture starts only once it's moved 10 px on one
   * axis, y first, as Motion's, and moves on that axis alone, so a parent that drags the other axis keeps
   * its gesture. A lock on an axis the drag doesn't move on, `axis: "y"` swiped sideways, refuses it.
   * Default `false`.
   */
  // #273, ADR-0047. Motion's drag starts at 3 px, claiming both axes, and locks after.
  readonly lock?: boolean | undefined
  /**
   * `false`: a press on the target starts no gesture, only a down handed to it does, as Motion's
   * `dragListener={false}` with drag controls. Default `true`: both do.
   */
  // #431, **Drag controls**.
  readonly listen?: boolean | undefined
  /**
   * `true`: the target was given drag controls, so the drag reads the pointer feed that also delivers the
   * downs they hand it (`InputSource.adoptablePointerOf`), and its `WatchedDrag` ends a gesture from
   * outside. Default `false`: the plain feed, and a `stop` and `cancel` that do nothing.
   */
  // #431, #507, #539: **Drag controls**.
  readonly adoptable?: boolean | undefined
  /**
   * How far, in px, a gesture from `down` moves before it starts, read at the down, as Motion's
   * `distanceThreshold`: `undefined`, or none given, is 3. A direction lock still waits for its 10 px on
   * one axis.
   */
  // #431.
  readonly threshold?: ((down: InputSource.PointerLikeEvent) => number | undefined) | undefined
  /**
   * Where each pointer point is for the gesture, as Motion's `transformPagePoint`: read at each down, and
   * applied to all that gesture's points, its down's and each move's. `undefined`, or none given, leaves
   * them as they are. It's handed the point on the screen and gives one; the scroll a hold counts in is
   * added back after.
   */
  // #443.
  readonly mapPoint?: LazyArg<PointMap | undefined> | undefined
}

/** A point mapped, as Motion's `transformPagePoint`: the Environment's coordinates in, the gesture's out. */
// #443.
export type PointMap = (point: Point.Point) => Point.Point

/** `watchPan`'s options. */
// #443.
export interface PanOptions {
  /** Where each pointer point is for the gesture, as `DragOptions`' `mapPoint`. */
  readonly mapPoint?: LazyArg<PointMap | undefined> | undefined
}

/**
 * A gesture's point mapping (#443): read at each down, `event` mapped while it's set. The point
 * mapped is the one on the screen (`x - scroll.x`), the scroll the hold counts in added back after.
 * Allocates only for a mapped gesture.
 */
const mappedEvents = (mapPoint: DragOptions["mapPoint"]): ((event: InputSource.PointerLikeEvent) => InputSource.PointerLikeEvent) => {
  if (Predicate.isUndefined(mapPoint)) return identity
  const current = MutableRef.make<PointMap | undefined>(undefined)
  return (event) => {
    if (event.type === "down") MutableRef.set(current, mapPoint())
    const mapping = MutableRef.get(current)
    if (Predicate.isUndefined(mapping)) return event
    const { scroll } = event
    const at = mapping({ x: event.x - scroll.x, y: event.y - scroll.y })
    return { ...event, x: at.x + scroll.x, y: at.y + scroll.y }
  }
}

/**
 * A drag's watch, which can end its gesture from outside its pointer, as Motion's drag controls' `stop`
 * and `cancel` do. Each tells its `"end"` inside the call, and does nothing when no gesture has started.
 * Only an `adoptable` watch, a target given drag controls, is ended so; any other's `stop` and `cancel`
 * do nothing.
 */
// #431, #539.
export interface WatchedDrag {
  /** Ends the gesture as its pointer's release would: an `"end"` at its last point, with its moves' velocity. */
  readonly stop: () => void
  /** Ends the gesture where it is: an `"end"` with no velocity, marked `cancelled`. */
  readonly cancel: () => void
}

/** A plain watch's ends from outside (#539): shared, and doing nothing. */
const NO_ENDS: WatchedDrag = { stop: constVoid, cancel: constVoid }

/** A drag's downs (#431): its own presses unless it doesn't `listen`, and those it adopted; each gesture's threshold its `threshold`'s, else 3. */
const dragDownsOf = (listen: boolean, threshold: DragOptions["threshold"]): Downs => ({
  claims: Bool.match(listen, { onTrue: () => constTrue, onFalse: () => isAdopted }),
  thresholdOf: UndefinedOr.match(threshold, {
    onUndefined: () => () => THRESHOLD,
    onDefined: (of) => (down: InputSource.PointerLikeEvent) => UndefinedOr.match(of(down), { onUndefined: () => THRESHOLD, onDefined: identity }),
  }),
})

/** The downs of a drag that listens to its presses and gives no `threshold`: every down, past 3 px. */
const EVERY_DOWN = /*#__PURE__*/ dragDownsOf(true, undefined)

/** A drag's fold, and a direction-locked one's, for {@link EVERY_DOWN}: built once (#539), as most drags have them. */
const DRAG_FOLD = /*#__PURE__*/ stepOf(pastThreshold, EVERY_DOWN)
const LOCKED_FOLD = /*#__PURE__*/ stepOf(locks, EVERY_DOWN)

/** A drag's fold (#431): a shared one for {@link EVERY_DOWN} (#539), else built for its own downs. */
const dragFoldOf = (lock: boolean, listen: boolean, threshold: DragOptions["threshold"]) =>
  Bool.match(Bool.and(listen, Predicate.isUndefined(threshold)), {
    onTrue: () => Bool.match(lock, { onTrue: () => LOCKED_FOLD, onFalse: () => DRAG_FOLD }),
    onFalse: () => stepOf(Bool.match(lock, { onTrue: () => locks, onFalse: () => pastThreshold }), dragDownsOf(listen, threshold)),
  })

/** `sample` kept to `axis`, and carrying it: a one-axis drag's off-axis offset, delta and velocity zeroed. */
const keepTo = (sample: Drag.Sample, axis: Drag.Axis): Drag.Sample =>
  Match.value(axis).pipe(
    Match.when("x", (): Drag.Sample => ({
      ...sample,
      offset: { x: sample.offset.x, y: 0 },
      delta: { x: sample.delta.x, y: 0 },
      velocity: { x: sample.velocity.x, y: 0 },
      axis: "x",
    })),
    Match.when("y", (): Drag.Sample => ({
      ...sample,
      offset: { x: 0, y: sample.offset.y },
      delta: { x: 0, y: sample.delta.y },
      velocity: { x: 0, y: sample.velocity.y },
      axis: "y",
    })),
    Match.orElse(() => sample),
  )

/**
 * A direction-locked gesture's axis: its lock from its start's `offset`, if the drag moves on it
 * (`configured` is `"xy"` or the lock); none for a lock on an axis it doesn't, which refuses it.
 */
const lockedAxis = (configured: Drag.Axis, offset: Point.Point): Option.Option<Drag.Axis> =>
  Option.filter(Option.fromUndefinedOr(lockOf(offset)), (locked) => Bool.or(configured === "xy", configured === locked))

/** `axis` as a function read at each gesture's start. */
const axisAtOf = (axis: Drag.Axis | LazyArg<Drag.Axis>): LazyArg<Drag.Axis> =>
  Match.value(axis).pipe(
    Match.when(Predicate.isString, (fixed) => constant(fixed)),
    Match.orElse((read) => read),
  )

/**
 * A drag on `target`, as a Stream of samples kept to its `axis`, with `watchDrag`'s rules: each sample
 * arrives inside its pointer event's dispatch, and the Stream ends when the input does, as a test's
 * script does.
 *
 * @example
 * DragRecognizer.drag(card, { axis: "x" }).pipe(Drag.withinBounds({ x: { min: 0, max: 200 } }))
 */
// A Stream over `watchDrag` (#379); each sample offered and flushed inside its event (ADR-0032).
export const drag = (target: unknown, options: DragOptions = {}): Stream.Stream<Drag.Sample, never, InputSource.InputSource> =>
  streamOf<Drag.Sample, InputSource.InputSource>((handlers) => watchDrag(target, options, handlers))

/**
 * Watches drags on `target` while the Scope is open: `handlers.on` hears each of a gesture's samples, kept
 * to its `axis`, inside its pointer event's dispatch.
 * - **It starts** once the pointer has moved `threshold` px, 3 by default, from its down.
 * - **Its axis is claimed** at its `"start"`, before `on` hears it, and counts as an active drag, so no
 *   hover or press starts elsewhere while it's on. Every watch on one target shares the claim. When
 *   another element holds an axis it needs, the gesture is refused: it tells nothing until its end, as a
 *   tap tells nothing, and doesn't retry. Of nested drags, the innermost claims first. With `claim: false`
 *   it only counts.
 * - **Its claim is given back** at its `"end"`, before `on` hears it, or when the Scope closes mid-drag,
 *   so a throw from `on` can't keep it.
 * - **Velocity** is the pointer's on each axis over the last 100 ms, read from the events' times.
 *
 * A down handed to the target starts a gesture as its own press does; with `listen: false`, only those
 * do. An `adoptable` watch gives back a `WatchedDrag` that ends a gesture from outside.
 *
 * @example
 * const watched = yield* DragRecognizer.watchDrag(slider, { axis: "x", adoptable: true }, { on: move })
 * watched.cancel() // ends the gesture where it is
 */
// #379, ADR-0055: no fiber and no Stream, a scoped subscription to the target's pointer feed, folded as
// `pan`'s is. Tier 2, for bindings. The claim is the target's **Drag claim**, which counts it in the
// runtime's **Drag activity** (ADR-0019, *Amendment (#29)*). Innermost first: a pointer's moves reach the
// targets it went down on innermost first, and each is handled inside its event (ADR-0032). A Stale
// gesture's end is the one cold-path log: `wardic.drag: stale gesture` with its rule. Velocity: Motion's
// `getVelocity`, `Velocity.trailing`, on every sample; the `"end"` sample counts the release point too
// (ADR-0004, *Amendment (#139)*); from event `timeStamp`s, so it needs no `Clock`, only `InputSource`.
// Adopted downs: #431 (`InputSource.adoptPointer`); a `WatchedDrag`'s ends do nothing once the Scope has
// closed, and any other watch's nothing at all (#539).
export const watchDrag = (
  target: unknown,
  { axis = "xy", claim = true, lock = false, listen = true, adoptable = false, threshold, mapPoint }: DragOptions,
  handlers: InputFeed.Handlers<Drag.Sample>,
): Effect.Effect<WatchedDrag, never, Scope.Scope | InputSource.InputSource> => {
  const attributes = { threshold: THRESHOLD, velocityWindowMs: VELOCITY_WINDOW_MS }
  const mapped = mappedEvents(mapPoint)
  const axisAt = axisAtOf(axis)
  const fold = dragFoldOf(lock, listen, threshold)
  const on = handlers.on
  return Effect.gen(function* () {
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    // The context, to log a Stale gesture's end inside its event.
    const log = Effect.runSyncWith(yield* Effect.context<never>())
    // This watch's gesture: its release (of its claim, or its count) while it holds one, its axis,
    // and whether it was refused, from its "start" to its "end".
    const held = MutableRef.make(Option.none<() => void>())
    const gestureAxis = MutableRef.make<Drag.Axis>("xy")
    const refused = MutableRef.make(false)
    const release = (): void =>
      Option.match(MutableRef.getAndSet(held, Option.none()), { onNone: constVoid, onSome: (releaseIt) => releaseIt() })

    /**
     * A gesture's start: its axis read (a direction-locked one's, its lock, if the drag moves on it),
     * then its claim taken, or refused. Whether it was taken.
     */
    const begin = (sample: Drag.Sample): boolean => {
      release()
      const taken = Option.flatMap(Bool.match(lock, { onTrue: () => lockedAxis(axisAt(), sample.offset), onFalse: () => Option.some(axisAt()) }), (gesture) => {
        MutableRef.set(gestureAxis, gesture)
        return Bool.match(claim, {
          onTrue: () => activity.claim(target, gesture),
          onFalse: () => Option.some(activity.count()),
        })
      })
      MutableRef.set(held, taken)
      MutableRef.set(refused, Option.isNone(taken))
      return Option.isSome(taken)
    }

    /** A gesture's end: its claim given back, a Stale one logged. Whether it's told (a refused one's isn't). */
    const end = (sample: Drag.Sample): boolean => {
      if (MutableRef.getAndSet(refused, false)) return false
      release()
      Option.match(Option.fromUndefinedOr(staleEnds.get(sample)), {
        onNone: constVoid,
        onSome: (rule) => log(Effect.logDebug("wardic.drag: stale gesture").pipe(Effect.annotateLogs({ ...attributes, rule }))),
      })
      return true
    }

    /** Each sample of a claimed gesture, kept to its axis, to `on`; nothing of a refused one. */
    const admit = (sample: Drag.Sample): void => {
      const told = Match.value(sample.phase).pipe(
        Match.when("start", () => begin(sample)),
        Match.when("move", () => Bool.not(MutableRef.get(refused))),
        Match.when("end", () => end(sample)),
        Match.exhaustive,
      )
      if (told) on(keepTo(sample, MutableRef.get(gestureAxis)))
    }

    // The gesture's state, which a pointer event or an end from outside (#431) folds.
    const state = MutableRef.make(initState)

    // Added first, so it runs last: after the feed has stopped.
    yield* Effect.addFinalizer(() => Effect.sync(release))
    // The adoptable feed only for a target given Drag controls (#507): a plain one subscribes no adoption.
    const feed = Bool.match(adoptable, { onTrue: () => InputSource.adoptablePointerOf(input, target), onFalse: () => input.pointer(target) })
    yield* watchFeed(
      "wardic.drag",
      attributes,
      feed,
      () => (event) => {
        const [next, samples] = fold(MutableRef.get(state), mapped(event))
        MutableRef.set(state, next)
        Arr.forEach(samples, admit)
        return true
      },
      handlers,
    )
    // Its ends from outside its pointer (#431) only for a target given Drag controls (#539): no other
    // is ended so. Closing the Scope stops them first.
    if (Bool.not(adoptable)) return NO_ENDS
    const closed = MutableRef.make(false)
    yield* Effect.addFinalizer(() => Effect.sync(() => MutableRef.set(closed, true)))
    /** The gesture ended from outside its pointer (#431): its `"end"` told, unless the Scope has closed. */
    const endFromOutside = (cancelled: boolean) => (): void => {
      if (MutableRef.get(closed)) return
      const [next, samples] = endedFromOutside(MutableRef.get(state), cancelled)
      MutableRef.set(state, next)
      Arr.forEach(samples, admit)
    }
    return { stop: endFromOutside(false), cancel: endFromOutside(true) }
  })
}

/**
 * A pan's sample: a drag's, or its session's start, `"session"`, as Motion's `onPanSessionStart`: at the
 * primary pointer's down on the target, at its point, with no offset, delta or velocity.
 */
// #273, ADR-0047.
export interface PanSample extends Omit<Drag.Sample, "phase"> {
  /** `"session"` at the down, then a drag's: `"start"` past the threshold, `"move"`, `"end"`. */
  readonly phase: "session" | Drag.Sample["phase"]
}

/** A pan's fold step: the next state, and its samples. */
type PanStep = readonly [DragState, ReadonlyArray<PanSample>]

/** The session's start at `down`, the gesture's owner now. */
const sessionOf = (down: InputSource.PointerLikeEvent): PanSample => ({
  point: pointOf(down),
  offset: { x: 0, y: 0 },
  delta: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  phase: "session",
  timeStamp: down.timeStamp,
  scroll: down.scroll,
  raw: down.raw,
  axis: "xy",
})

/**
 * The drag's fold, with a session's start at each down that claims a gesture: after the end of a
 * lost one, which that down closes (rule B). A down the drag ignores (another pointer while one owns
 * the gesture, or one that isn't primary) starts none.
 */
const panStep = (state: DragState, event: InputSource.PointerLikeEvent): PanStep => {
  const [next, samples] = panFold(state, event)
  if (event.type !== "down") return [next, samples]
  if (next === state) return [next, samples]
  return [next, Arr.append(samples, sessionOf(event))]
}

/**
 * A pan on `target`, as Motion's pan gesture: its session's start at the primary pointer's down, then a
 * drag's `"start"` past its threshold, a `"move"` at each move, and an `"end"` at the release, a cancel
 * or a lost release. It moves nothing.
 *
 * A pan claims no axis, so it never stops a drag, nested or not, and no drag stops it. Once started it
 * counts as an active drag until its end, so a press it took over ends as neither a tap nor a cancel,
 * and no hover starts meanwhile: that's Wardic's, not Motion's, whose swipe let go over a tappable
 * element taps it too.
 */
// #273, ADR-0047: no **Drag claim**; counted in the **Drag activity**. Motion's pan is invisible to its
// drag lock.
export const pan = (target: unknown): Stream.Stream<PanSample, never, InputSource.InputSource> =>
  streamOf<PanSample, InputSource.InputSource>((handlers) => watchPan(target, handlers))

/**
 * Watches pans on `target` while the Scope is open: `handlers.on` hears each of `pan`'s samples inside the
 * pointer event's dispatch. A started pan counts as an active drag from its `"start"` to its `"end"`, or
 * until the Scope closes on one still going.
 */
// #318, ADR-0055: its count in the **Drag activity**. Tier 2.
export const watchPan = (target: unknown, handlers: InputFeed.Handlers<PanSample>, options: PanOptions = {}): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
  const attributes = { threshold: THRESHOLD, velocityWindowMs: VELOCITY_WINDOW_MS }
  return Effect.gen(function* () {
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    // The started pan's count in the Drag activity, held from its "start" to its "end".
    const held = MutableRef.make(Option.none<() => void>())
    const release = (): void =>
      Option.match(MutableRef.getAndSet(held, Option.none()), { onNone: constVoid, onSome: (releaseIt) => releaseIt() })
    /** A sample's count: taken at its start, before anyone hears it; given back at its end. */
    const counted = (sample: PanSample): void => {
      if (sample.phase === "start") {
        release()
        MutableRef.set(held, Option.some(activity.count()))
      }
      if (sample.phase === "end") release()
    }
    // Added first, so it runs last: after the feed has stopped.
    yield* Effect.addFinalizer(() => Effect.sync(release))
    yield* watchFeed(
      "wardic.pan",
      attributes,
      input.pointer(target),
      () => {
        const state = MutableRef.make(initState)
        const mapped = mappedEvents(options.mapPoint)
        return (event) => {
          const [next, samples] = panStep(MutableRef.get(state), mapped(event))
          MutableRef.set(state, next)
          Arr.forEach(samples, (sample) => {
            counted(sample)
            handlers.on(sample)
          })
          return true
        }
      },
      handlers,
    )
  })
}
