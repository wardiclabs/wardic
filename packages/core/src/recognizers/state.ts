import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { FocusLikeEvent, PointerLikeEvent } from "../services/InputSource.ts"
import { InputSource, isPrimaryPointer } from "../services/InputSource.ts"
import { Probe } from "../services/Probe.ts"
import { DragActivity, type DragActivityShape } from "./drag-activity.ts"

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
      if (fold.fromInitial) {
        return events.pipe(
          Stream.mapAccum(
            () => fold.initial,
            (state, ev) => {
              const next = fold.step(state, ev)
              const active = fold.active(next)
              return [next, active === fold.active(state) ? NONE : [active]] as const
            },
          ),
        )
      }
      return events.pipe(
        Stream.mapAccum(
          () => fold.initial,
          (state, ev) => {
            const next = fold.step(state, ev)
            return [next, [fold.active(next)]] as const
          },
        ),
        Stream.changes,
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan(span, { attributes }))

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

/** Whether `event` ends a held pointer's press: its release, its cancel, or a move with no button pressed. */
const endsPress = (event: PointerLikeEvent): boolean =>
  event.type === "up" || event.type === "cancel" || (event.type === "move" && event.buttons === 0)

/**
 * Hover's fold, after Motion's `hover` (`motion-dom/src/gestures/hover.ts` @ `16c6122`,
 * ADR-0019): touch never hovers; an enter while a drag is active (**Drag activity**)
 * starts nothing; a leave while a pointer that went down on the target is held waits
 * for that pointer's release, its cancel or its first unpressed move, then ends the
 * hover unless the pointer came back in first. An enter during a drag doesn't count,
 * so a dragged element whose pointer left and came back ends its hover at the release
 * (Motion's `hover.ts:78-81, 109-112` do the same).
 */
const hoverFold = (activity: DragActivityShape): Fold<HoverState, PointerLikeEvent> => ({
  initial: noHover,
  fromInitial: true,
  active: (s) => s.inside || s.deferred,
  step: (s, e) => {
    if (e.pointerType === "touch") return s
    switch (e.type) {
      case "enter":
        return activity.isDragActive() ? s : { ...s, inside: true, deferred: false }
      case "leave":
        if (!s.inside) return s
        return { ...s, inside: false, deferred: s.held !== null }
      case "down":
        return s.held === null ? { ...s, held: e.pointerId } : s
      default:
        if (e.pointerId !== s.held || !endsPress(e)) return s
        return { ...s, held: null, deferred: false }
    }
  },
})

/**
 * Recognize hover state on `target`: `true` while the pointer is inside, `false` once it
 * leaves. A leave while a pointer pressed on `target` is held waits for its release;
 * touch never hovers; no hover starts while a drag is active (ADR-0019). Emits only on
 * transitions.
 */
export const hover = (target: unknown): Stream.Stream<boolean, never, InputSource> =>
  stateRecognizer(
    "wardic.hover",
    {},
    Effect.gen(function* () {
      const input = yield* InputSource
      const activity = yield* DragActivity
      return { events: input.pointer(target), fold: hoverFold(activity) }
    }),
  )

/**
 * Press's fold: the **Primary pointer** that pressed owns the press (`null` when none
 * does). It ends at that pointer's release, its cancel, or its first move with no button
 * pressed (a lost release, ADR-0019). No press starts while a drag is active. A second
 * down from the owner (a lost release) keeps it pressed.
 */
const pressFold = (activity: DragActivityShape): Fold<number | null, PointerLikeEvent> => ({
  initial: null,
  fromInitial: true,
  active: (owner) => owner !== null,
  step: (owner, e) => {
    if (!isPrimaryPointer(e)) return owner
    if (e.type === "down") return owner !== null || activity.isDragActive() ? owner : e.pointerId
    return e.pointerId === owner && endsPress(e) ? null : owner
  },
})

/**
 * Recognize press state on `target`: `true` while the primary pointer that pressed it is
 * held down, `false` once released or cancelled, wherever that happens (a **Held
 * pointer**'s release reaches the target), or at its first unpressed move after a lost
 * release. No press starts while a drag is active (ADR-0019). Emits only on transitions.
 */
export const press = (target: unknown): Stream.Stream<boolean, never, InputSource> =>
  stateRecognizer(
    "wardic.press",
    {},
    Effect.gen(function* () {
      const input = yield* InputSource
      const activity = yield* DragActivity
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
export const focus = (target: unknown): Stream.Stream<boolean, never, InputSource> =>
  stateRecognizer(
    "wardic.focus",
    {},
    Effect.map(InputSource, (i) => ({
      events: i.focus(target),
      fold: booleanFold((e: FocusLikeEvent) => e.type === "focus"),
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
  options?: { readonly once?: boolean },
): Stream.Stream<boolean, never, Probe> => {
  const base = stateRecognizer(
    "wardic.inView",
    {},
    Effect.map(Probe, (p) => ({
      events: p.observeIntersection(target),
      fold: booleanFold((inView: boolean) => inView),
    })),
  )
  return options?.once === true ? base.pipe(Stream.takeUntil((active) => active)) : base
}
