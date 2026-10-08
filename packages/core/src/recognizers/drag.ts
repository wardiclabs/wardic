import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import type { PointerLikeEvent } from "../services/InputSource.ts"
import { InputSource, isPrimaryPointer } from "../services/InputSource.ts"
import { DragActivity } from "./drag-activity.ts"

/** A 2D vector — pointer position and the per-axis quantities derived from it. */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

/**
 * One emission from the `drag` recognizer — an Effect-free, portable signal.
 *
 * - `point`: the current pointer position (environment coordinates).
 * - `offset`: `point - origin`, measured from the down-point that started the
 *   gesture (total displacement of the drag).
 * - `delta`: `point - lastPoint`, the change since the previous emitted event.
 * - `velocity`: a per-axis, time-windowed estimate in units per second.
 * - `phase`: `"start"` on activation, `"move"` while dragging, `"end"` on
 *   release/cancel. A cancel ends at the last move's point with the moves' velocity
 *   (a `pointercancel`'s own coordinates aren't the pointer's: Chromium's carries
 *   (0, 0)). A **Stale gesture** (its release was lost, ADR-0019) also ends:
 *   at the owning pointer's first move with no button pressed, or its next down,
 *   with an `"end"` at the last pressed point, no delta and no velocity.
 * - `timeStamp`: the time (ms) of the event that produced it (a scroll-driven move
 *   carries the scroll's; a Stale gesture's end carries the event that ended it).
 */
export interface DragSample {
  readonly point: Vec2
  readonly offset: Vec2
  readonly delta: Vec2
  readonly velocity: Vec2
  readonly phase: "start" | "move" | "end"
  readonly timeStamp: number
}

/**
 * Movement distance (px) from the down-origin required before a gesture
 * activates. Below this the pointer is treated as a tap-in-progress and no
 * samples are emitted; crossing it promotes the gesture to `"start"`.
 */
const THRESHOLD = 3

/**
 * Width (ms) of the trailing window used to estimate release velocity. Velocity
 * is computed from the oldest sample still inside `newest.t - VELOCITY_WINDOW_MS`
 * up to the newest, so a single stale frame can't skew the fling speed.
 */
const VELOCITY_WINDOW_MS = 30

/** A timestamped pointer position retained for the velocity window. */
interface HistorySample {
  readonly x: number
  readonly y: number
  readonly t: number
}

interface DragState {
  readonly phase: "idle" | "active"
  readonly ownerId: number | null
  readonly origin: Vec2
  readonly last: Vec2
  readonly history: ReadonlyArray<HistorySample>
}

const initState: DragState = {
  phase: "idle",
  ownerId: null,
  origin: { x: 0, y: 0 },
  last: { x: 0, y: 0 },
  history: [],
}

/** Euclidean distance between two points. */
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** No motion: a velocity of zero on both axes. */
const still = (): Vec2 => ({ x: 0, y: 0 })

/**
 * Push the newest sample and drop everything older than the window, keeping at
 * least the oldest entry still inside `newest.t - VELOCITY_WINDOW_MS`.
 */
const pushHistory = (
  history: ReadonlyArray<HistorySample>,
  sample: HistorySample,
): ReadonlyArray<HistorySample> => {
  const cutoff = sample.t - VELOCITY_WINDOW_MS
  // Keep every sample within the window; the boundary check uses `>=` so the
  // sample exactly at the cutoff is retained, guaranteeing a non-empty window.
  return Arr.filter(Arr.append(history, sample), (s) => s.t >= cutoff)
}

/** Per-axis velocity (units/sec) from `oldest` to `newest`; a zero time span is still. */
const velocityBetween = (oldest: HistorySample, newest: HistorySample): Vec2 => {
  const dtSeconds = (newest.t - oldest.t) / 1000
  return Bool.match(dtSeconds === 0, {
    onTrue: still,
    onFalse: () => ({ x: (newest.x - oldest.x) / dtSeconds, y: (newest.y - oldest.y) / dtSeconds }),
  })
}

/**
 * Per-axis time-windowed velocity (units/sec) from the oldest in-window sample
 * to the newest. A single sample, or a zero time span, is still.
 */
const windowVelocity = (history: ReadonlyArray<HistorySample>): Vec2 =>
  Arr.match(history, {
    onEmpty: still,
    onNonEmpty: (samples) =>
      Bool.match(samples.length < 2, {
        onTrue: still,
        onFalse: () => velocityBetween(Arr.headNonEmpty(samples), Arr.lastNonEmpty(samples)),
      }),
  })

/** Why a Stale gesture ended: its owner moved with no button pressed (rule A), or went down again (rule B). */
type StaleRule = "unpressed move" | "second down"

/**
 * The `"end"` samples that close a Stale gesture, and why (read by {@link drag}'s
 * cold-path log). A WeakMap, so the fold stays pure and allocates nothing more.
 */
const staleEnds = new WeakMap<DragSample, StaleRule>()

/** No samples: the event changes nothing a consumer sees. */
const NO_SAMPLES: ReadonlyArray<DragSample> = []

/**
 * The end of a Stale gesture: an `"end"` at its last pressed point, with no delta and
 * no velocity (a lost release carries no Fling). A gesture that never started (below
 * the threshold) just resets and emits nothing.
 */
const staleEnd = (state: DragState, rule: StaleRule, timeStamp: number): ReadonlyArray<DragSample> =>
  Bool.match(state.phase === "active", {
    onFalse: () => NO_SAMPLES,
    onTrue: () => {
      const sample: DragSample = {
        point: state.last,
        offset: { x: state.last.x - state.origin.x, y: state.last.y - state.origin.y },
        delta: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        phase: "end",
        timeStamp,
      }
      staleEnds.set(sample, rule)
      return [sample]
    },
  })

/** A gesture claimed by `event`, a down. */
const claimedBy = (event: PointerLikeEvent, point: Vec2): DragState => ({
  phase: "idle",
  ownerId: event.pointerId,
  origin: point,
  last: point,
  history: [{ x: point.x, y: point.y, t: event.timeStamp }],
})

/** One fold step: the next state, and the samples it emits. */
type Step = readonly [DragState, ReadonlyArray<DragSample>]

/** An event the drag ignores: the state as it was, and no samples. */
const ignored = (state: DragState): Step => [state, NO_SAMPLES]

/** The event's pointer position. */
const pointOf = (event: PointerLikeEvent): Vec2 => ({ x: event.x, y: event.y })

/** A down: it claims a free gesture; the owner's second down ends its lost one (rule B). */
const onDown = (state: DragState, event: PointerLikeEvent): Step => {
  const point = pointOf(event)
  return Option.match(Option.fromNullOr(state.ownerId), {
    onNone: () => [claimedBy(event, point), NO_SAMPLES],
    onSome: (owner) =>
      Bool.match(event.pointerId === owner, {
        // Rule B: the owner went down again, so its release was lost.
        onTrue: () => [claimedBy(event, point), staleEnd(state, "second down", event.timeStamp)],
        // Another pointer while one owns the gesture — ignore.
        onFalse: () => ignored(state),
      }),
  })
}

/**
 * The owner's release or cancel: an active gesture emits its final `"end"`; a release before
 * the threshold is a tap and emits nothing. Either way the state resets.
 */
const onRelease = (state: DragState, event: PointerLikeEvent): Step =>
  Bool.match(state.phase === "active", {
    onFalse: () => [initState, NO_SAMPLES],
    onTrue: () => {
      // A cancel's coordinates aren't the pointer's (Chromium's pointercancel carries
      // (0, 0)), so it ends at the last move's point, with the moves' velocity, as
      // Motion's pan session does (PanSession.ts:329-333 at 16c6122).
      const sample: DragSample = Bool.match(event.type === "cancel", {
        onTrue: () => ({
          point: state.last,
          offset: { x: state.last.x - state.origin.x, y: state.last.y - state.origin.y },
          delta: { x: 0, y: 0 },
          velocity: windowVelocity(state.history),
          phase: "end",
          timeStamp: event.timeStamp,
        }),
        onFalse: () => {
          const point = pointOf(event)
          const history = pushHistory(state.history, { x: point.x, y: point.y, t: event.timeStamp })
          return {
            point,
            offset: { x: point.x - state.origin.x, y: point.y - state.origin.y },
            delta: { x: point.x - state.last.x, y: point.y - state.last.y },
            velocity: windowVelocity(history),
            phase: "end",
            timeStamp: event.timeStamp,
          }
        },
      })
      return [initState, [sample]]
    },
  })

/** The owner's move: below the threshold it primes the history; crossing it starts; then every move emits. */
const onMove = (state: DragState, event: PointerLikeEvent): Step => {
  const point = pointOf(event)
  const history = pushHistory(state.history, { x: point.x, y: point.y, t: event.timeStamp })
  const offset: Vec2 = { x: point.x - state.origin.x, y: point.y - state.origin.y }
  const delta: Vec2 = { x: point.x - state.last.x, y: point.y - state.last.y }
  const sample = (phase: DragSample["phase"]): DragSample => ({
    point,
    offset,
    delta,
    velocity: windowVelocity(history),
    phase,
    timeStamp: event.timeStamp,
  })
  return Match.value(state.phase).pipe(
    Match.when("idle", (): Step =>
      Bool.match(dist(state.origin, point) <= THRESHOLD, {
        // Below threshold: keep origin fixed, advance last/history so velocity is
        // primed, but suppress output.
        onTrue: (): Step => [{ ...state, last: point, history }, NO_SAMPLES],
        // Crossing the threshold promotes the gesture and emits "start".
        onFalse: (): Step => [{ ...state, phase: "active", last: point, history }, [sample("start")]],
      }),
    ),
    // Active: every move emits.
    Match.when("active", (): Step => [{ ...state, last: point, history }, [sample("move")]]),
    Match.exhaustive,
  )
}

/** An event from the gesture's owner, other than a down. */
const onOwner = (state: DragState, event: PointerLikeEvent): Step =>
  Match.value(event).pipe(
    // Rule A: the owner moved with no button pressed, so its release was lost.
    Match.when({ type: "move", buttons: 0 }, (e): Step => [initState, staleEnd(state, "unpressed move", e.timeStamp)]),
    // Release / cancel from the owner: emit final "end", reset.
    Match.when({ type: Match.is("up", "cancel") }, (e) => onRelease(state, e)),
    // Movement from the owner.
    Match.when({ type: "move" }, (e) => onMove(state, e)),
    // "enter"/"leave" and anything else: no-op for drag.
    Match.orElse(() => ignored(state)),
  )

/**
 * Fold one pointer event into the drag state, emitting zero or more samples.
 *
 * Only the **Primary pointer** counts (Motion's `isPrimaryPointer`): a right-click or a
 * second finger is ignored. Zero-or-more output: activation/sub-threshold/non-owner
 * events emit `[]`; threshold crossing emits one `"start"`; subsequent moves emit one
 * `"move"`; release/cancel emits one `"end"`. A Stale gesture (ADR-0019) ends at the
 * owner's move with `buttons === 0` (rule A) or its next down (rule B, which then
 * claims the new gesture): see {@link staleEnd}. Runs once per pointer event, not per frame
 * (ADR-0025); no logging here.
 */
const step = (state: DragState, event: PointerLikeEvent): Step =>
  Match.value(event).pipe(
    Match.when(Predicate.not(isPrimaryPointer), () => ignored(state)),
    // --- Activation: a "down" claims the gesture. ---
    Match.when({ type: "down" }, (down) => onDown(state, down)),
    // No owner yet, or an event from a non-owning pointer — ignore.
    Match.orElse((e) =>
      Bool.match(e.pointerId === state.ownerId, { onTrue: () => onOwner(state, e), onFalse: () => ignored(state) }),
    ),
  )

/**
 * Recognize a drag gesture on `target`, emitting a `DragSample` stream.
 *
 * Built like the scalar primitives (`scalar.ts`/`chase.ts`): a `Stream.unwrap`
 * over an `Effect.gen` that resolves `InputSource`, logs subscribe (annotated),
 * and folds the pointer stream with `Stream.mapAccum`. The whole stream runs in
 * a `wardic.drag` span; per-sample folding stays silent (hot path).
 *
 * The drag claims the runtime's **Drag activity** at its `"start"` and releases it at
 * its `"end"`, or when the stream is interrupted mid-gesture, so a hover or press
 * elsewhere can't start while it is on (ADR-0019). A Stale gesture's end is the one
 * cold-path log: `wardic.drag: stale gesture` with its rule.
 *
 * Velocity is a time-windowed (~30ms) per-axis estimate read from event
 * `timeStamp`s, so the recognizer needs no `Clock` — only `InputSource`.
 */
export const drag = (target: unknown): Stream.Stream<DragSample, never, InputSource> => {
  const attributes = { threshold: THRESHOLD, velocityWindowMs: VELOCITY_WINDOW_MS }
  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* InputSource
      const activity = yield* DragActivity
      yield* Effect.logDebug("wardic.drag: subscribe").pipe(Effect.annotateLogs(attributes))
      // This subscription's claim on the Drag activity, held from "start" to "end": its release.
      const claim = MutableRef.make(Option.none<() => void>())
      const unclaim = (): void => {
        Option.match(MutableRef.get(claim), { onNone: constVoid, onSome: (release) => release() })
        MutableRef.set(claim, Option.none())
      }
      return input.pointer(target).pipe(
        Stream.mapAccum(() => initState, step),
        Stream.tap((sample) =>
          Match.value(sample.phase).pipe(
            Match.when("start", () =>
              Effect.sync(() => {
                unclaim()
                MutableRef.set(claim, Option.some(activity.claim()))
              }),
            ),
            Match.when("end", () =>
              Effect.sync(unclaim).pipe(
                Effect.andThen(
                  Option.match(Option.fromUndefinedOr(staleEnds.get(sample)), {
                    onNone: () => Effect.void,
                    onSome: (rule) => Effect.logDebug("wardic.drag: stale gesture").pipe(Effect.annotateLogs({ rule })),
                  }),
                ),
              ),
            ),
            Match.orElse(() => Effect.void),
          ),
        ),
        Stream.ensuring(Effect.sync(unclaim)),
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.drag", { attributes }))
}
