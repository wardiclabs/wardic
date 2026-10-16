/**
 * The `Recognizer` module: CONTEXT.md's Recognizers, each a `Stream` of a gesture's state from an
 * Environment's input: `hover`, `press`, `focus`, `inView`, and `drag`, whose samples are
 * `Drag.Sample`s.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constant, constVoid, type LazyArg } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type * as Drag from "./Drag.ts"
import * as DragActivity from "./DragActivity.ts"
import * as InputSource from "./InputSource.ts"
import type * as Point from "./Point.ts"
import * as Probe from "./Probe.ts"
import * as Velocity from "./Velocity.ts"

/**
 * One state recognizer's fold: a start state, a pure step per event, and the boolean
 * ("active") the recognizer emits for a state. `press` and `hover` fold a small state
 * (the pointer that owns a press, a deferred leave); `focus` and `inView` fold the
 * boolean itself.
 */
interface Fold<S, Ev> {
  readonly initial: S
  readonly step: (state: S, event: Ev) => S
  readonly active: (state: S) => boolean
  /**
   * Emit only when `active` changes, starting from the initial state's, so an event
   * that changes nothing emits nothing (`hover`, `press`). Otherwise the first event's
   * value is emitted too, then only changes (`focus`, and `inView`, whose first report
   * says whether the target starts in view).
   */
  readonly fromInitial: boolean
}

/** No emission: shared, so an event that changes nothing allocates nothing. */
const NONE: ReadonlyArray<boolean> = []

/**
 * Shared shell for the boolean "state" recognizers (`hover`/`press`/`focus`/
 * `inView`). Each one resolves a service, subscribes to an event stream, and
 * folds events with a pure {@link Fold}. The shell owns the common machinery so the
 * recognizers reduce to a span name and the service-resolving `acquire`, which
 * returns the events and the fold:
 *
 * - `Stream.unwrap(Effect.gen)` — resolve the service then return the stream.
 * - annotated `logDebug("<span>: subscribe")` on subscribe (cold setup, not the
 *   hot path); per-event folding stays silent.
 * - `Stream.mapAccum` over the fold's state, seeded via a thunk (mirrors
 *   drag/scalar). A `fromInitial` fold emits the state's boolean only when it changes;
 *   any other emits it each event and `Stream.changes` dedups consecutive equal
 *   booleans. Either way only transitions are surfaced.
 * - `Effect.annotateLogs(attributes)` + `Stream.withSpan(span, { attributes })`
 *   wrap the whole thing in observability, matching the `wardic.*` convention.
 */
const stateRecognizer = <Ev, S, R>(
  span: string,
  attributes: Record<string, unknown>,
  acquire: Effect.Effect<{ readonly events: Stream.Stream<Ev>; readonly fold: Fold<S, Ev> }, never, R>,
): Stream.Stream<boolean, never, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug(`${span}: subscribe`).pipe(Effect.annotateLogs(attributes))
      const { events, fold } = yield* acquire
      return Bool.match(fold.fromInitial, {
        onTrue: () =>
          events.pipe(
            Stream.mapAccum(
              () => fold.initial,
              (state, ev) => {
                const next = fold.step(state, ev)
                const active = fold.active(next)
                return [next, Bool.match(active === fold.active(state), { onTrue: () => NONE, onFalse: () => [active] })] as const
              },
            ),
          ),
        onFalse: () =>
          events.pipe(
            Stream.mapAccum(
              () => fold.initial,
              (state, ev) => {
                const next = fold.step(state, ev)
                return [next, [fold.active(next)]] as const
              },
            ),
            Stream.changes,
          ),
      })
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan(span, { attributes, captureStackTrace: false }))

/**
 * Hover's state: whether the pointer is inside the target, the pointer that went down
 * on the target and is still held (if any), and whether a leave waits for its release.
 */
interface HoverState {
  readonly inside: boolean
  readonly held: number | null
  readonly deferred: boolean
}

const noHover: HoverState = { inside: false, held: null, deferred: false }

/** An event of one type. */
const ofType =
  (type: InputSource.PointerLikeEvent["type"]): Predicate.Predicate<InputSource.PointerLikeEvent> =>
  (event) =>
    event.type === type

/** A move with no button pressed: the release was lost (ADR-0019). */
const isUnpressedMove: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.and(ofType("move"), (event) => Bool.not(event.pressed))

/** Whether `event` ends a held pointer's press: its release, its cancel, or a move with no button pressed. */
const endsPress: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.some([ofType("up"), ofType("cancel"), isUnpressedMove])

/**
 * Hover's fold, after Motion's `hover` (`motion-dom/src/gestures/hover.ts` @ `16c6122`,
 * ADR-0019): touch never hovers; an enter while a drag is active (**Drag activity**)
 * starts nothing; a leave while a pointer that went down on the target is held waits
 * for that pointer's release, its cancel or its first unpressed move, then ends the
 * hover unless the pointer came back in first. An enter during a drag doesn't count,
 * so a dragged element whose pointer left and came back ends its hover at the release
 * (Motion's `hover.ts:78-81, 109-112` do the same).
 */
const hoverFold = (activity: DragActivity.Shape): Fold<HoverState, InputSource.PointerLikeEvent> => ({
  initial: noHover,
  fromInitial: true,
  active: (s) => Bool.or(s.inside, s.deferred),
  step: (s, e) =>
    Match.value(e).pipe(
      Match.when({ kind: "touch" }, () => s),
      Match.when({ type: "enter" }, () =>
        Bool.match(activity.isDragActive(), { onTrue: () => s, onFalse: () => ({ ...s, inside: true, deferred: false }) }),
      ),
      Match.when({ type: "leave" }, () =>
        Bool.match(s.inside, { onTrue: () => ({ ...s, inside: false, deferred: Predicate.isNotNull(s.held) }), onFalse: () => s }),
      ),
      Match.when({ type: "down" }, (down) =>
        Option.match(Option.fromNullOr(s.held), { onNone: () => ({ ...s, held: down.pointerId }), onSome: () => s }),
      ),
      Match.orElse((other) =>
        Bool.match(Bool.and(other.pointerId === s.held, endsPress(other)), {
          onTrue: () => ({ ...s, held: null, deferred: false }),
          onFalse: () => s,
        }),
      ),
    ),
})

/**
 * Recognize hover state on `target`: `true` while the pointer is inside, `false` once it
 * leaves. A leave while a pointer pressed on `target` is held waits for its release;
 * touch never hovers; no hover starts while a drag is active (ADR-0019). Emits only on
 * transitions.
 */
export const hover = (target: unknown): Stream.Stream<boolean, never, InputSource.InputSource> =>
  stateRecognizer(
    "wardic.hover",
    {},
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const activity = yield* DragActivity.DragActivity
      return { events: input.pointer(target), fold: hoverFold(activity) }
    }),
  )

/**
 * Press's fold: the **Primary pointer** that pressed owns the press (`null` when none
 * does). It ends at that pointer's release, its cancel, or its first move with no button
 * pressed (a lost release, ADR-0019). No press starts while a drag is active. A second
 * down from the owner (a lost release) keeps it pressed.
 */
const pressFold = (activity: DragActivity.Shape): Fold<number | null, InputSource.PointerLikeEvent> => ({
  initial: null,
  fromInitial: true,
  active: Predicate.isNotNull,
  step: (owner, e) =>
    Match.value(e).pipe(
      Match.when(Predicate.not(InputSource.isPrimaryPointer), () => owner),
      Match.when({ type: "down" }, (down) =>
        Bool.match(Bool.or(Predicate.isNotNull(owner), activity.isDragActive()), {
          onTrue: () => owner,
          onFalse: () => down.pointerId,
        }),
      ),
      Match.orElse((other) =>
        Bool.match(Bool.and(other.pointerId === owner, endsPress(other)), { onTrue: () => null, onFalse: () => owner }),
      ),
    ),
})

/**
 * Recognize press state on `target`: `true` while the primary pointer that pressed it is
 * held down, `false` once released or cancelled, wherever that happens (a **Held
 * pointer**'s release reaches the target), or at its first unpressed move after a lost
 * release. No press starts while a drag is active (ADR-0019). Emits only on transitions.
 */
export const press = (target: unknown): Stream.Stream<boolean, never, InputSource.InputSource> =>
  stateRecognizer(
    "wardic.press",
    {},
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const activity = yield* DragActivity.DragActivity
      return { events: input.pointer(target), fold: pressFold(activity) }
    }),
  )

/** The fold of a recognizer whose events already say whether it is active. */
const booleanFold = <Ev>(activeOf: (event: Ev) => boolean): Fold<boolean, Ev> => ({
  initial: false,
  fromInitial: false,
  step: (_active, event) => activeOf(event),
  active: (active) => active,
})

/**
 * Recognize focus state on `target`: `true` while focused, `false` once
 * blurred. `focus` -> `true`, `blur` -> `false`. Emits only on transitions.
 */
export const focus = (target: unknown): Stream.Stream<boolean, never, InputSource.InputSource> =>
  stateRecognizer(
    "wardic.focus",
    {},
    Effect.map(InputSource.InputSource, (i) => ({
      events: i.focus(target),
      fold: booleanFold((e: InputSource.FocusLikeEvent) => e.type === "focus"),
    })),
  )

/**
 * Recognize in-view (intersection) state on `target` via `Probe`. The probe's
 * `observeIntersection` already emits booleans, so the fold is the identity on
 * the event. Runs through the same shell for the `wardic.inView` span/log and
 * `Stream.changes` dedup.
 *
 * With `{ once: true }` the stream settles after (and including) the first
 * `true` — `Stream.takeUntil(active => active)` keeps the terminating `true`
 * and ends the stream, so once-in-view targets never go back to `false`.
 */
export const inView = (
  target: unknown,
  options: { readonly once?: boolean } = {},
): Stream.Stream<boolean, never, Probe.Probe> => {
  const base = stateRecognizer(
    "wardic.inView",
    {},
    Effect.map(Probe.Probe, (p) => ({
      events: p.observeIntersection(target),
      fold: booleanFold((inView: boolean) => inView),
    })),
  )
  return Bool.match(options.once === true, {
    onTrue: () => base.pipe(Stream.takeUntil((active) => active)),
    onFalse: () => base,
  })
}

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
  readonly origin: Point.Point
  readonly last: Point.Point
  readonly history: ReadonlyArray<Velocity.TimedPoint>
}

const initState: DragState = {
  phase: "idle",
  ownerId: null,
  origin: { x: 0, y: 0 },
  last: { x: 0, y: 0 },
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
const staleEnds = new WeakMap<Drag.Sample, StaleRule>()

/** No samples: the event changes nothing a consumer sees. */
const NO_SAMPLES: ReadonlyArray<Drag.Sample> = []

/**
 * The end of a Stale gesture: an `"end"` at its last pressed point, with no delta and
 * no velocity (a lost release carries no Fling). A gesture that never started (below
 * the threshold) just resets and emits nothing.
 */
const staleEnd = (state: DragState, rule: StaleRule, timeStamp: number): ReadonlyArray<Drag.Sample> =>
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
      }
      staleEnds.set(sample, rule)
      return [sample]
    },
  })

/** A gesture claimed by `event`, a down. */
const claimedBy = (event: InputSource.PointerLikeEvent, point: Point.Point): DragState => ({
  phase: "idle",
  ownerId: event.pointerId,
  origin: point,
  last: point,
  history: [{ x: point.x, y: point.y, timeStamp: event.timeStamp }],
})

/** One fold step: the next state, and the samples it emits. */
type Step = readonly [DragState, ReadonlyArray<Drag.Sample>]

/** An event the drag ignores: the state as it was, and no samples. */
const ignored = (state: DragState): Step => [state, NO_SAMPLES]

/** The event's pointer position. */
const pointOf = (event: InputSource.PointerLikeEvent): Point.Point => ({ x: event.x, y: event.y })

/** A down: it claims a free gesture; the owner's second down ends its lost one (rule B). */
const onDown = (state: DragState, event: InputSource.PointerLikeEvent): Step => {
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
          }
        },
      })
      return [initState, [sample]]
    },
  })

/** The owner's move: below the threshold it primes the history; crossing it starts; then every move emits. */
const onMove = (state: DragState, event: InputSource.PointerLikeEvent): Step => {
  const point = pointOf(event)
  const history = pushHistory(state.history, { x: point.x, y: point.y, timeStamp: event.timeStamp })
  const offset: Point.Point = { x: point.x - state.origin.x, y: point.y - state.origin.y }
  const delta: Point.Point = { x: point.x - state.last.x, y: point.y - state.last.y }
  const sample = (phase: Drag.Sample["phase"]): Drag.Sample => ({
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
const onOwner = (state: DragState, event: InputSource.PointerLikeEvent): Step =>
  Match.value(event).pipe(
    // Rule A: the owner moved with no button pressed, so its release was lost.
    Match.when({ type: "move", pressed: false }, (e): Step => [initState, staleEnd(state, "unpressed move", e.timeStamp)]),
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
 * Only the **Primary pointer** counts (Motion's `InputSource.isPrimaryPointer`): a right-click or a
 * second finger is ignored. Zero-or-more output: activation/sub-threshold/non-owner
 * events emit `[]`; threshold crossing emits one `"start"`; subsequent moves emit one
 * `"move"`; release/cancel emits one `"end"`. A Stale gesture (ADR-0019) ends at the
 * owner's move with `buttons === 0` (rule A) or its next down (rule B, which then
 * claims the new gesture): see {@link staleEnd}. Runs once per pointer event, not per frame
 * (ADR-0025); no logging here.
 */
const step = (state: DragState, event: InputSource.PointerLikeEvent): Step =>
  Match.value(event).pipe(
    Match.when(Predicate.not(InputSource.isPrimaryPointer), () => ignored(state)),
    // --- Activation: a "down" claims the gesture. ---
    Match.when({ type: "down" }, (down) => onDown(state, down)),
    // No owner yet, or an event from a non-owning pointer — ignore.
    Match.orElse((e) =>
      Bool.match(e.pointerId === state.ownerId, { onTrue: () => onOwner(state, e), onFalse: () => ignored(state) }),
    ),
  )

/** `drag`'s options (ADR-0019, *Amendment (#29)*). */
export interface DragOptions {
  /**
   * The axes the drag moves on, and claims (`"xy"` by default). A one-axis drag's samples have
   * their off-axis `offset`, `delta` and `velocity` zeroed; `point` and `phase` are left as they
   * are. A function is read at each gesture's start and holds to its end (a `<Reorder>` item's
   * axis, decided per gesture, ADR-0020).
   */
  readonly axis?: Drag.Axis | LazyArg<Drag.Axis> | undefined
  /**
   * `false`: the drag takes no **Drag claim** and is never refused (Motion's `dragPropagation`).
   * It still counts in the **Drag activity**, so no hover or press starts while it is on.
   */
  readonly claim?: boolean | undefined
}

/** `sample` kept to `axis`: a one-axis drag's off-axis offset, delta and velocity zeroed. */
const keepTo = (sample: Drag.Sample, axis: Drag.Axis): Drag.Sample =>
  Match.value(axis).pipe(
    Match.when("x", () => ({
      ...sample,
      offset: { x: sample.offset.x, y: 0 },
      delta: { x: sample.delta.x, y: 0 },
      velocity: { x: sample.velocity.x, y: 0 },
    })),
    Match.when("y", () => ({
      ...sample,
      offset: { x: 0, y: sample.offset.y },
      delta: { x: 0, y: sample.delta.y },
      velocity: { x: 0, y: sample.velocity.y },
    })),
    Match.orElse(() => sample),
  )

/** `axis` as a function read at each gesture's start. */
const axisAtOf = (axis: Drag.Axis | LazyArg<Drag.Axis>): LazyArg<Drag.Axis> =>
  Match.value(axis).pipe(
    Match.when(Predicate.isString, (fixed) => constant(fixed)),
    Match.orElse((read) => read),
  )

/**
 * Recognize a drag gesture on `target`, emitting a `Drag.Sample` stream, kept to its `axis`.
 *
 * Built like the scalar primitives (`scalar.ts`/`chase.ts`): a `Stream.unwrap`
 * over an `Effect.gen` that resolves `InputSource`, logs subscribe (annotated),
 * and folds the pointer stream with `Stream.mapAccum`. The whole stream runs in
 * a `wardic.drag` span; per-sample folding stays silent (hot path).
 *
 * At its `"start"` the drag reads its axis and takes its target's **Drag claim** on it, which
 * also counts it in the runtime's **Drag activity**, so a hover or press elsewhere can't start
 * while it is on (ADR-0019). Every subscription on one target shares the claim. When another
 * target holds an axis it needs, the gesture is refused: it emits nothing until its end, as a tap
 * emits nothing, and doesn't retry. Of nested draggables the innermost claims first: a pointer's
 * moves reach the targets it went down on innermost first, and each is handled inside its event
 * (ADR-0032). With `claim: false` the drag only counts in the Drag activity. Either is released at
 * the gesture's `"end"`, or when the stream is interrupted mid-gesture (ADR-0019, *Amendment
 * (#29)*). A Stale gesture's end is the one cold-path log: `wardic.drag: stale gesture` with its
 * rule.
 *
 * Velocity is the pointer's per axis over the gesture's last 100 ms (Motion's `getVelocity`,
 * `Velocity.trailing`), on every sample; the `"end"` sample counts the release point too
 * (ADR-0004, *Amendment (#139)*). It's read from event `timeStamp`s, so the recognizer needs
 * no `Clock` — only `InputSource`.
 */
export const drag = (
  target: unknown,
  { axis = "xy", claim = true }: DragOptions = {},
): Stream.Stream<Drag.Sample, never, InputSource.InputSource> => {
  const attributes = { threshold: THRESHOLD, velocityWindowMs: VELOCITY_WINDOW_MS }
  const axisAt = axisAtOf(axis)
  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      const activity = yield* DragActivity.DragActivity
      yield* Effect.logDebug("wardic.drag: subscribe").pipe(Effect.annotateLogs(attributes))
      // This subscription's gesture: its release (of its claim, or its count) while it holds one,
      // its axis, and whether it was refused, from its "start" to its "end".
      const held = MutableRef.make(Option.none<() => void>())
      const gestureAxis = MutableRef.make<Drag.Axis>("xy")
      const refused = MutableRef.make(false)
      const release = (): void =>
        Option.match(MutableRef.getAndSet(held, Option.none()), { onNone: constVoid, onSome: (releaseIt) => releaseIt() })

      /** A gesture's start: its axis read, then its claim taken, or refused. Whether it was taken. */
      const begin = (): boolean => {
        release()
        const gesture = axisAt()
        MutableRef.set(gestureAxis, gesture)
        const taken = Bool.match(claim, {
          onTrue: () => activity.claim(target, gesture),
          onFalse: () => Option.some(activity.count()),
        })
        MutableRef.set(held, taken)
        MutableRef.set(refused, Option.isNone(taken))
        return Option.isSome(taken)
      }

      const kept = (sample: Drag.Sample): Result.Result<Drag.Sample, Drag.Sample> =>
        Result.succeed(keepTo(sample, MutableRef.get(gestureAxis)))

      /** Each sample of a claimed gesture, kept to its axis; nothing of a refused one. */
      const admit = (sample: Drag.Sample): Effect.Effect<Result.Result<Drag.Sample, Drag.Sample>> =>
        Match.value(sample.phase).pipe(
          Match.when("start", () =>
            Effect.sync(() => Bool.match(begin(), { onTrue: () => kept(sample), onFalse: () => Result.fail(sample) }))),
          Match.when("move", () =>
            Effect.sync(() =>
              Bool.match(MutableRef.get(refused), { onTrue: () => Result.fail(sample), onFalse: () => kept(sample) })
            )),
          Match.when("end", () =>
            Bool.match(MutableRef.getAndSet(refused, false), {
              onTrue: () => Effect.succeed(Result.fail(sample)),
              onFalse: () =>
                Effect.sync(release).pipe(
                  Effect.andThen(
                    Option.match(Option.fromUndefinedOr(staleEnds.get(sample)), {
                      onNone: () => Effect.void,
                      onSome: (rule) => Effect.logDebug("wardic.drag: stale gesture").pipe(Effect.annotateLogs({ rule })),
                    }),
                  ),
                  Effect.andThen(Effect.sync(() => kept(sample))),
                ),
            })),
          Match.exhaustive,
        )

      return input.pointer(target).pipe(
        Stream.mapAccum(() => initState, step),
        Stream.filterMapEffect(admit),
        Stream.ensuring(Effect.sync(release)),
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.drag", { attributes, captureStackTrace: false }))
}
