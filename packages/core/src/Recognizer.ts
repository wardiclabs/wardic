/**
 * The `Recognizer` module: CONTEXT.md's Recognizers, each a `Stream` of a gesture's state from an
 * Environment's input: `hover`, `press`, `focus`, `inView`, `drag`, whose samples are
 * `Drag.Sample`s, and `pan`, whose are a drag's and its session's start.
 *
 * Every one but `drag` is also a watch (#318, ADR-0055): `watchHover`, `watchPress`, `watchFocus`,
 * `watchInView` and `watchPan` run a callback inside each event's dispatch while a Scope is open,
 * with no fiber or Stream of their own. The Streams are built over them.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constant, constFalse, constTrue, constVoid, type LazyArg } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Drag from "./Drag.ts"
import * as DragActivity from "./DragActivity.ts"
import * as InputFeed from "./InputFeed.ts"
import * as InputSource from "./InputSource.ts"
import type * as Point from "./Point.ts"
import * as Probe from "./Probe.ts"
import * as Velocity from "./Velocity.ts"

/**
 * One state recognizer's fold: a start state, a pure step per event, and the boolean
 * ("active") the recognizer emits for a state. `press` and `hover` fold a small state
 * (the pointer that owns a press, whether a drag took it over, a deferred leave); `focus`
 * and `inView` fold the boolean itself.
 */
interface Fold<S, Ev> {
  readonly initial: S
  readonly step: (state: S, event: Ev) => S
  readonly active: (state: S) => boolean
}

// --- Watches: a recognizer as an Effect-scoped callback (#318, ADR-0055) ----------------------

/**
 * A watch's run (#318): `feed` watched while the Scope is open (`InputFeed.watchWith`), each event
 * handled inside its dispatch by a handler `makeHandle` makes for this subscription, with no fiber and
 * no Stream. Its span lasts as long (`Effect.withSpanScoped`), and its log is at the start, as a
 * Stream recognizer's were at subscribe. A handler returns whether to go on: `false` stops the
 * subscription (`once`).
 */
const watchFeed = <Ev>(
  span: string,
  attributes: Record<string, unknown>,
  feed: InputFeed.InputFeed<Ev>,
  makeHandle: () => (event: Ev) => boolean,
  handlers: Pick<InputFeed.Handlers<never>, "onDefect" | "onEnd">,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.logDebug(`${span}: watch`).pipe(
    Effect.andThen(InputFeed.watchWith(feed, makeHandle, handlers)),
    Effect.annotateLogs(attributes),
    Effect.withSpanScoped(span, { attributes, captureStackTrace: false }),
  )

/**
 * A fold's transitions as a watch's handler (#257, #318): `on` told each change of whether it's
 * active, as `out` makes it of the state, the event that turned it and whether it's on now; an event
 * that changes nothing tells nothing. With `once`, done at the first that's on.
 */
const transitionsOf =
  <S, Ev, Out>(fold: Fold<S, Ev>, out: (next: S, event: Ev, active: boolean) => Out, on: (out: Out) => void, once: boolean) =>
  (): ((event: Ev) => boolean) => {
    const state = MutableRef.make(fold.initial)
    return (event) => {
      const was = MutableRef.get(state)
      const next = fold.step(was, event)
      MutableRef.set(state, next)
      const active = fold.active(next)
      if (active === fold.active(was)) return true
      on(out(next, event, active))
      return Bool.not(Bool.and(once, active))
    }
  }

/**
 * A fold's states as a watch's handler (`focus`, `inView`, whose first report is a state): `on` told
 * the first event's, then each change. With `once`, done at the first that's on.
 */
const statesOf =
  <S, Ev>(fold: Fold<S, Ev>, on: (active: boolean) => void, once: boolean) =>
  (): ((event: Ev) => boolean) => {
    const state = MutableRef.make(fold.initial)
    const told = MutableRef.make(Option.none<boolean>())
    return (event) => {
      const next = fold.step(MutableRef.get(state), event)
      MutableRef.set(state, next)
      const active = fold.active(next)
      if (Option.contains(MutableRef.get(told), active)) return true
      MutableRef.set(told, Option.some(active))
      on(active)
      return Bool.not(Bool.and(once, active))
    }
  }

/**
 * A watch as a Stream (#318): each value offered and flushed inside the dispatch (ADR-0032), the
 * Stream ended when the feed runs out, or after the first value `done` says ends it (`once`).
 */
const streamOf = <A, R>(
  watch: (handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | R>,
  done: (value: A) => boolean = constFalse,
): Stream.Stream<A, never, Exclude<R, Scope.Scope>> =>
  Stream.callback<A, never, R>((queue) =>
    watch({
      on: (value) => {
        Queue.offerUnsafe(queue, value)
        Queue.flushUnsafe(queue)
        if (done(value)) Queue.endUnsafe(queue)
      },
      onEnd: () => {
        Queue.endUnsafe(queue)
      },
    })
  )

/**
 * A gesture's transition (#257): whether it's on now, and the event that turned it, whose
 * `x`/`y` (less its `scroll`) say where the pointer was.
 */
export interface Transition {
  readonly active: boolean
  readonly event: InputSource.PointerLikeEvent
}

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
  Stream.map(hoverEvents(target), activeOf)

/**
 * {@link hover}'s transitions with the event that turned each (#257): a hover's start and
 * end, and where the pointer was (Motion's `onHoverStart` / `onHoverEnd`). A Stream over
 * {@link watchHover}.
 */
export const hoverEvents = (target: unknown): Stream.Stream<Transition, never, InputSource.InputSource> =>
  streamOf<Transition, InputSource.InputSource>((handlers) => watchHover(target, handlers))

/**
 * {@link watchHover}'s handlers (#397): `on` told each transition, and `onMove`, when given, each move
 * of the pointer over the target while the hover is on. That's Wardic's own: Motion's hover has only a
 * start and an end. Touch never hovers, and a held pointer whose leave waits for its release isn't
 * over the target, so neither moves it.
 */
export interface HoverHandlers extends InputFeed.Handlers<Transition> {
  readonly onMove?: ((event: InputSource.PointerLikeEvent) => void) | undefined
}

/**
 * Watch hover on `target` (#318, ADR-0055): `handlers.on` told each transition, {@link hoverEvents}',
 * and `handlers.onMove` each move over it while the hover is on (#397), inside the pointer event's
 * dispatch, while the Scope is open. No fiber and no Stream: a scoped subscription to the target's
 * pointer feed. A throw from either goes to `handlers.onDefect`. Tier 2, for bindings.
 */
export const watchHover = (target: unknown, handlers: HoverHandlers): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> =>
  Effect.gen(function* () {
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    const fold = hoverFold(activity)
    const handle = UndefinedOr.match(handlers.onMove, {
      onUndefined: () => transitionsOf(fold, transitionOf, handlers.on, false),
      onDefined: (onMove) => hoverHandleOf(fold, handlers.on, onMove),
    })
    yield* watchFeed("wardic.hover", {}, input.pointer(target), handle, handlers)
  })

/** Whether `event` moves a pointer over the target while `state`'s hover is on (#397). */
const movesOver = (state: HoverState, event: InputSource.PointerLikeEvent): boolean =>
  Bool.and(Bool.and(state.inside, event.type === "move"), Bool.and(event.onTarget, event.kind !== "touch"))

/** Hover's transitions, as {@link transitionsOf}'s, and each move over the target between them (#397). */
const hoverHandleOf =
  (fold: Fold<HoverState, InputSource.PointerLikeEvent>, on: (transition: Transition) => void, onMove: (event: InputSource.PointerLikeEvent) => void) =>
  (): ((event: InputSource.PointerLikeEvent) => boolean) => {
    const state = MutableRef.make(fold.initial)
    return (event) => {
      const was = MutableRef.get(state)
      const next = fold.step(was, event)
      MutableRef.set(state, next)
      const active = fold.active(next)
      if (active !== fold.active(was)) {
        on({ active, event })
        return true
      }
      if (movesOver(next, event)) onMove(event)
      return true
    }
  }

/** A transition of the state it changed to (#257). */
const transitionOf = (_next: unknown, event: InputSource.PointerLikeEvent, active: boolean): Transition => ({ active, event })

/** Whether a transition turned its gesture on. */
const activeOf = (transition: Transition): boolean => transition.active

/** A **Keyboard press**'s key (#427). */
type PressKey = "enter" | "space"

/**
 * Press's state: the **Primary pointer** that pressed, or the key of a **Keyboard press** (#427), each
 * `null` when none does, and whether a drag was active at any of its events since (#257): a press a
 * drag took over is no tap. One press at a time: a pointer's or a key's.
 */
interface PressState {
  readonly owner: number | null
  readonly key: PressKey | null
  readonly dragged: boolean
}

const noPress: PressState = { owner: null, key: null, dragged: false }

/** Whether a press is held, by a pointer or a key. */
const isPressed = (s: PressState): boolean => Bool.or(Predicate.isNotNull(s.owner), Predicate.isNotNull(s.key))

/**
 * Press's pointer step: the **Primary pointer** that pressed owns the press. It ends at that
 * pointer's release, its cancel, or its first move with no button pressed (a lost release, ADR-0019).
 * No press starts while a drag is active, nor while a key holds one (#427). A second down from the
 * owner (a lost release) keeps it pressed. Each of the owner's events notes whether a drag is active
 * (#257).
 */
const pointerStep = (activity: DragActivity.Shape) => (s: PressState, e: InputSource.PointerLikeEvent): PressState =>
  Match.value(e).pipe(
    Match.when(Predicate.not(InputSource.isPrimaryPointer), () => s),
    Match.when({ type: "down" }, (down) =>
      Bool.match(Bool.or(isPressed(s), activity.isDragActive()), {
        onTrue: () => s,
        onFalse: (): PressState => ({ owner: down.pointerId, key: null, dragged: false }),
      }),
    ),
    Match.orElse((other) => Bool.match(other.pointerId === s.owner, { onTrue: () => ownersEvent(s, other, activity), onFalse: () => s })),
  )

/** The press's owner's event, other than a down: the press ends at its end, and a drag active now is noted. */
const ownersEvent = (s: PressState, e: InputSource.PointerLikeEvent, activity: DragActivity.Shape): PressState => {
  const dragged = Bool.or(s.dragged, activity.isDragActive())
  return Bool.match(endsPress(e), {
    onTrue: (): PressState => ({ owner: null, key: null, dragged }),
    onFalse: () => Bool.match(dragged === s.dragged, { onTrue: () => s, onFalse: (): PressState => ({ owner: s.owner, key: null, dragged }) }),
  })
}

/** A key that presses (#427): Enter, or Space where the target doesn't type it. */
const pressKeyOf = (e: InputSource.KeyboardLikeEvent): PressKey | null =>
  Match.value(e.key).pipe(
    Match.when("enter", (): PressKey | null => "enter"),
    Match.when("space", (): PressKey | null => Bool.match(e.action === "type", { onTrue: () => null, onFalse: (): PressKey => "space" })),
    Match.orElse(() => null),
  )

/**
 * Whether a key's down starts a **Keyboard press** (#427): a pressing key, not a repeat, from the
 * target itself, that nothing took first, with no press held and no drag active.
 */
const startsKeyPress = (s: PressState, e: InputSource.KeyboardLikeEvent, activity: DragActivity.Shape): boolean =>
  Bool.every([e.type === "down", Bool.not(e.repeat), e.fromTarget, Bool.not(e.handled), Bool.not(isPressed(s)), Bool.not(activity.isDragActive())])

/**
 * Press's key step (#427): a pressing key's down starts a **Keyboard press**, and the same key's up
 * ends it, noting a drag active then. Other keys, and other keys' ups, change nothing.
 */
const keyStep = (activity: DragActivity.Shape) => (s: PressState, e: InputSource.KeyboardLikeEvent): PressState => {
  const key = pressKeyOf(e)
  if (Predicate.isNull(key)) return s
  if (startsKeyPress(s, e, activity)) return { owner: null, key, dragged: false }
  return Bool.match(Bool.and(e.type === "up", key === s.key), {
    onTrue: (): PressState => ({ owner: null, key: null, dragged: Bool.or(s.dragged, activity.isDragActive()) }),
    onFalse: () => s,
  })
}

/** Press's focus step (#427): a blur cancels a **Keyboard press**; a pointer's press goes on. */
const focusStep = (s: PressState, e: InputSource.FocusLikeEvent): PressState =>
  Bool.match(Bool.and(e.type === "blur", Predicate.isNotNull(s.key)), {
    onTrue: (): PressState => ({ owner: null, key: null, dragged: s.dragged }),
    onFalse: () => s,
  })

/**
 * Recognize press state on `target`: `true` while the primary pointer that pressed it is
 * held down, `false` once released or cancelled, wherever that happens (a **Held
 * pointer**'s release reaches the target), or at its first unpressed move after a lost
 * release; and the same for a **Keyboard press** on it (#427), held while its key is down. No press
 * starts while a drag is active (ADR-0019). Emits only on transitions.
 */
export const press = (target: unknown, options?: PressOptions): Stream.Stream<boolean, never, InputSource.InputSource> =>
  Stream.map(pressEvents(target, options), pressing)

/**
 * How a press began or ended (#257, Motion's press): `"start"` at its down; `"tap"`, a release
 * on the target or inside it, or a **Keyboard press**'s key coming up (#427); `"cancel"`, a release
 * elsewhere, a cancel, a lost release, or a blur ending a Keyboard press; `"dragged"`, an end after a
 * drag was active, which Motion tells as neither.
 */
export type PressPhase = "start" | "tap" | "cancel" | "dragged"

/**
 * A press's start or end (#257), and the event it came with: a pointer's (`input: "pointer"`), or a
 * **Keyboard press**'s key, or the blur that cancelled it (`input: "keyboard"`, #427).
 */
export type PressEvent =
  | { readonly phase: PressPhase; readonly input: "pointer"; readonly event: InputSource.PointerLikeEvent }
  | { readonly phase: PressPhase; readonly input: "keyboard"; readonly event: InputSource.KeyboardLikeEvent | InputSource.FocusLikeEvent }

/**
 * A press's options (#427): `keys: false` leaves out **Keyboard presses**, for a target whose Enter
 * and Space are someone else's (a Reorder item's, which lift it, ADR-0037).
 */
export interface PressOptions {
  readonly keys?: boolean | undefined
}

/**
 * {@link press}'s transitions, each with how it began or ended (#257): Motion's `onTapStart`,
 * `onTap` and `onTapCancel`, and a press a drag took over, which Motion tells as neither. A Stream
 * over {@link watchPress}.
 */
export const pressEvents = (target: unknown, options?: PressOptions): Stream.Stream<PressEvent, never, InputSource.InputSource> =>
  streamOf<PressEvent, InputSource.InputSource>((handlers) => watchPress(target, handlers, options))

/**
 * Watch presses on `target` (#318, ADR-0055): `handlers.on` told each start and end, {@link pressEvents}',
 * inside the event's dispatch, while the Scope is open, as {@link watchHover}. A pointer's press, or a
 * **Keyboard press** (#427): one fold over the target's pointer, keys and focus, each feed watched
 * with its own step. `handlers.onEnd` is told once every feed has run out. Tier 2.
 */
export const watchPress = (
  target: unknown,
  handlers: InputFeed.Handlers<PressEvent>,
  options?: PressOptions,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> =>
  Effect.gen(function* () {
    yield* Effect.logDebug("wardic.press: watch")
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    const keys = UndefinedOr.match(options, { onUndefined: constTrue, onDefined: (o) => o.keys !== false })
    const state = MutableRef.make(noPress)
    const feeds = MutableRef.make(Bool.match(keys, { onTrue: () => 3, onFalse: () => 1 }))
    const watching: Pick<InputFeed.Handlers<never>, "onDefect" | "onEnd"> = {
      onDefect: handlers.onDefect,
      onEnd: () => {
        MutableRef.set(feeds, MutableRef.get(feeds) - 1)
        if (MutableRef.get(feeds) === 0) UndefinedOr.map(handlers.onEnd, (onEnd) => onEnd())
      },
    }
    const step =
      <Ev>(next: (s: PressState, e: Ev) => PressState, out: (ended: PressState, e: Ev, active: boolean) => PressEvent, taken: (e: Ev, out: PressEvent) => void) =>
      () =>
      (event: Ev): boolean => {
        const was = MutableRef.get(state)
        const now = next(was, event)
        MutableRef.set(state, now)
        const active = isPressed(now)
        if (active === isPressed(was)) return true
        const told = out(now, event, active)
        taken(event, told)
        handlers.on(told)
        return true
      }
    yield* InputFeed.watchWith(input.pointer(target), step(pointerStep(activity), pointerPressOf, constVoid), watching)
    if (Bool.not(keys)) return
    yield* InputFeed.watchWith(input.keyboard(target), step(keyStep(activity), keyPressOf, takeSpace), watching)
    yield* InputFeed.watchWith(input.focus(target), step(focusStep, blurPressOf, constVoid), watching)
  }).pipe(Effect.withSpanScoped("wardic.press", { attributes: {}, captureStackTrace: false }))

/** A pointer's press transition, with how it began or ended. */
const pointerPressOf = (next: PressState, event: InputSource.PointerLikeEvent, active: boolean): PressEvent => ({
  phase: Bool.match(active, { onTrue: (): PressPhase => "start", onFalse: () => endOf(next, event) }),
  input: "pointer",
  event,
})

/** A **Keyboard press**'s transition (#427): its start at its key's down, its end at its up, a tap unless a drag took it over. */
const keyPressOf = (next: PressState, event: InputSource.KeyboardLikeEvent, active: boolean): PressEvent => ({
  phase: Bool.match(active, {
    onTrue: (): PressPhase => "start",
    onFalse: () => Bool.match(next.dragged, { onTrue: (): PressPhase => "dragged", onFalse: (): PressPhase => "tap" }),
  }),
  input: "keyboard",
  event,
})

/** A **Keyboard press** a blur ended (#427): a cancel. */
const blurPressOf = (next: PressState, event: InputSource.FocusLikeEvent): PressEvent => ({
  phase: Bool.match(next.dragged, { onTrue: (): PressPhase => "dragged", onFalse: (): PressPhase => "cancel" }),
  input: "keyboard",
  event,
})

/**
 * Space's down starting a **Keyboard press** is taken where its target does nothing with it (#427):
 * the page would scroll. A target that acts on it (a button, whose click Space's taken down would
 * stop) keeps it.
 */
const takeSpace = (event: InputSource.KeyboardLikeEvent, told: PressEvent): void => {
  if (Bool.and(told.phase === "start", Bool.and(event.key === "space", event.action === "none"))) event.handle()
}

/** How a pointer's press ended: after a drag, in a release on the target, or otherwise. */
const endOf = (ended: PressState, event: InputSource.PointerLikeEvent): PressPhase =>
  Bool.match(ended.dragged, {
    onTrue: (): PressPhase => "dragged",
    onFalse: () => Bool.match(Bool.and(event.type === "up", event.onTarget), { onTrue: (): PressPhase => "tap", onFalse: () => "cancel" }),
  })

/** Whether a press event is its start. */
const pressing = (event: PressEvent): boolean => event.phase === "start"

/** The fold of a recognizer whose events already say whether it is active. */
const booleanFold = <Ev>(activeOf: (event: Ev) => boolean): Fold<boolean, Ev> => ({
  initial: false,
  step: (_active, event) => activeOf(event),
  active: (active) => active,
})

/**
 * Recognize focus state on `target`: `true` while focused, `false` once
 * blurred. `focus` -> `true`, `blur` -> `false`. Emits only on transitions.
 *
 * With `{ visible: true }` (#273, Motion's `whileFocus`), only a focus the Environment shows counts
 * (`FocusLikeEvent.visible`, the DOM's `:focus-visible`): a keyboard's, not a pointer's click.
 */
export const focus = (target: unknown, options: FocusOptions = {}): Stream.Stream<boolean, never, InputSource.InputSource> =>
  streamOf<boolean, InputSource.InputSource>((handlers) => watchFocus(target, options, handlers))

/** {@link focus}'s options: `visible`, only a focus the Environment shows (#273). */
export interface FocusOptions {
  readonly visible?: boolean
}

/**
 * Watch focus on `target` (#318, ADR-0055): `handlers.on` told its first report, then each change,
 * {@link focus}', inside the focus event's dispatch, while the Scope is open. Tier 2.
 */
export const watchFocus = (
  target: unknown,
  options: FocusOptions,
  handlers: InputFeed.Handlers<boolean>,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
  const visibleOnly = options.visible === true
  return Effect.flatMap(InputSource.InputSource, (input) =>
    watchFeed(
      "wardic.focus",
      { visibleOnly },
      input.focus(target),
      statesOf(booleanFold((e: InputSource.FocusLikeEvent) => Bool.and(e.type === "focus", Bool.or(Bool.not(visibleOnly), e.visible !== false))), handlers.on, false),
      handlers,
    ))
}

/**
 * {@link inView}'s options (#273, Motion's `viewport`): the Probe's {@link Probe.IntersectionOptions}
 * (`root`, `margin`, `amount`), and `once`: settled at the first entry, in view from then on.
 */
export interface InViewOptions extends Probe.IntersectionOptions {
  readonly once?: boolean | undefined
}

/** The Probe's options of `options`, with no `once`. */
const intersectionOf = ({ once: _once, ...options }: InViewOptions): Probe.IntersectionOptions => options

/** Whether an intersection is in. */
const intersecting = (intersection: Probe.Intersection): boolean => intersection.intersecting

/**
 * Recognize in-view (intersection) state on `target` via `Probe`: its first report, then its changes,
 * against `options`' root, margin and amount. A Stream over a watch (#318), as {@link focus}: the
 * `wardic.inView` span and log, and only changes after the first report.
 *
 * With `{ once: true }` the stream ends after (and including) the first `true`, and the observer
 * goes with it, so a once-in-view target never goes back to `false`.
 */
export const inView = (target: unknown, options: InViewOptions = {}): Stream.Stream<boolean, never, Probe.Probe> =>
  streamOf<boolean, Probe.Probe>(
    (handlers) =>
      Effect.flatMap(Probe.Probe, (probe) =>
        watchFeed(
          "wardic.inView",
          {},
          probe.observeIntersection(target, intersectionOf(options)),
          statesOf(booleanFold(intersecting), handlers.on, options.once === true),
          handlers,
        )),
    (active) => Bool.and(options.once === true, active),
  )

/** An in-view transition (#273): whether the target is in now, and the platform's record of it (the DOM's entry). */
export interface ViewTransition {
  readonly active: boolean
  readonly raw?: unknown
}

/**
 * {@link inView}'s transitions (#273, Motion's `onViewportEnter` / `onViewportLeave`): from out of
 * view, each entry and leave, with the platform's record of it. A target that starts out of view tells
 * nothing until it enters, as Motion's. With `{ once: true }` it ends at the first entry: no leave.
 */
export const inViewEvents = (target: unknown, options: InViewOptions = {}): Stream.Stream<ViewTransition, never, Probe.Probe> =>
  streamOf<ViewTransition, Probe.Probe>(
    (handlers) => watchInView(target, options, handlers),
    (transition) => Bool.and(options.once === true, transition.active),
  )

/**
 * Watch `target`'s view (#318, ADR-0055): `handlers.on` told each entry and leave, {@link inViewEvents}',
 * while the Scope is open; with `once`, the first entry only, then its observer goes. Tier 2.
 */
export const watchInView = (
  target: unknown,
  options: InViewOptions,
  handlers: InputFeed.Handlers<ViewTransition>,
): Effect.Effect<void, never, Scope.Scope | Probe.Probe> =>
  Effect.flatMap(Probe.Probe, (probe) =>
    watchFeed(
      "wardic.inView",
      {},
      probe.observeIntersection(target, intersectionOf(options)),
      transitionsOf(booleanFold(intersecting), viewTransitionOf, handlers.on, options.once === true),
      handlers,
    ))

/** An in-view transition of the intersection that turned it. */
const viewTransitionOf = (_next: boolean, intersection: Probe.Intersection, active: boolean): ViewTransition => ({ active, raw: intersection.raw })

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
  /** The scroll counted into `last` (#257): a sample at `last` carries it. */
  readonly lastScroll: Point.Point
  readonly history: ReadonlyArray<Velocity.TimedPoint>
}

const initState: DragState = {
  phase: "idle",
  ownerId: null,
  origin: { x: 0, y: 0 },
  last: { x: 0, y: 0 },
  lastScroll: InputSource.NO_SCROLL,
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

/** A gesture claimed by `event`, a down. */
const claimedBy = (event: InputSource.PointerLikeEvent, point: Point.Point): DragState => ({
  phase: "idle",
  ownerId: event.pointerId,
  origin: point,
  last: point,
  lastScroll: event.scroll,
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
        onTrue: () => [claimedBy(event, point), staleEnd(state, "second down", event.timeStamp, event.raw)],
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

/** Whether a gesture moved from `origin` to `point` has started: a rule of {@link stepOf}. */
type Starts = (origin: Point.Point, point: Point.Point) => boolean

/** A drag's: past the threshold, in any direction. */
const pastThreshold: Starts = (origin, point) => dist(origin, point) > THRESHOLD

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

/** A direction-locked drag's: past the lock threshold on one axis. */
const locks: Starts = (origin, point) => Predicate.isNotUndefined(lockOf({ x: point.x - origin.x, y: point.y - origin.y }))

/** The owner's move: before the gesture `starts` it primes the history; starting emits "start"; then every move emits. */
const onMove = (state: DragState, event: InputSource.PointerLikeEvent, starts: Starts): Step => {
  const point = pointOf(event)
  const history = pushHistory(state.history, { x: point.x, y: point.y, timeStamp: event.timeStamp })
  const offset: Point.Point = { x: point.x - state.origin.x, y: point.y - state.origin.y }
  const delta: Point.Point = { x: point.x - state.last.x, y: point.y - state.last.y }
  const lastScroll = event.scroll
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
      Bool.match(starts(state.origin, point), {
        // Starting promotes the gesture and emits "start".
        onTrue: (): Step => [{ ...state, phase: "active", last: point, lastScroll, history }, [sample("start")]],
        // Not yet: keep origin fixed, advance last/history so velocity is primed, but suppress output.
        onFalse: (): Step => [{ ...state, last: point, lastScroll, history }, NO_SAMPLES],
      }),
    ),
    // Active: every move emits.
    Match.when("active", (): Step => [{ ...state, last: point, lastScroll, history }, [sample("move")]]),
    Match.exhaustive,
  )
}

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
 * that `starts` as it says.
 *
 * Only the **Primary pointer** counts (Motion's `InputSource.isPrimaryPointer`): a right-click or a
 * second finger is ignored. Zero-or-more output: activation/sub-threshold/non-owner
 * events emit `[]`; threshold crossing emits one `"start"`; subsequent moves emit one
 * `"move"`; release/cancel emits one `"end"`. A Stale gesture (ADR-0019) ends at the
 * owner's move with `buttons === 0` (rule A) or its next down (rule B, which then
 * claims the new gesture): see {@link staleEnd}. Runs once per pointer event, not per frame
 * (ADR-0025); no logging here.
 */
const stepOf = (starts: Starts) => (state: DragState, event: InputSource.PointerLikeEvent): Step =>
  Match.value(event).pipe(
    Match.when(Predicate.not(InputSource.isPrimaryPointer), () => ignored(state)),
    // --- Activation: a "down" claims the gesture. ---
    Match.when({ type: "down" }, (down) => onDown(state, down)),
    // No owner yet, or an event from a non-owning pointer — ignore.
    Match.orElse((e) =>
      Bool.match(e.pointerId === state.ownerId, { onTrue: () => onOwner(state, e, starts), onFalse: () => ignored(state) }),
    ),
  )

/** A drag's (and a pan's) fold: it starts past the threshold. */
const step = stepOf(pastThreshold)

/** A direction-locked drag's fold: it starts past the lock threshold on one axis (#273). */
const lockedStep = stepOf(locks)

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
  /**
   * A direction lock (Motion's `dragDirectionLock`, #273, ADR-0047): the gesture starts only once its
   * offset passes 10 px on one axis (y first, as Motion's), and moves on, claims and counts on that axis
   * alone: a parent that drags the other axis keeps its gesture. A lock on an axis the drag doesn't move
   * on (`axis: "y"`, swiped sideways) refuses it. Motion's drag starts at 3 px, claiming both axes, and
   * locks after.
   */
  readonly lock?: boolean | undefined
}

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
 * Recognize a drag gesture on `target`, emitting a `Drag.Sample` stream, kept to its `axis`: a Stream
 * over {@link watchDrag} (#379), whose rules it has. Each sample is offered and flushed inside its
 * pointer event's dispatch (ADR-0032), and the Stream ends when the input does (a test's script).
 */
export const drag = (target: unknown, options: DragOptions = {}): Stream.Stream<Drag.Sample, never, InputSource.InputSource> =>
  streamOf<Drag.Sample, InputSource.InputSource>((handlers) => watchDrag(target, options, handlers))

/**
 * Watch drags on `target` (#379, ADR-0055): `handlers.on` told each of a gesture's samples, kept to its
 * `axis`, inside its pointer event's dispatch, while the Scope is open. No fiber and no Stream: a
 * scoped subscription to the target's pointer feed, folded as {@link pan}'s is. Tier 2, for bindings.
 *
 * At its `"start"` the drag reads its axis and takes its target's **Drag claim** on it, which
 * also counts it in the runtime's **Drag activity**, so a hover or press elsewhere can't start
 * while it is on (ADR-0019). Every watch on one target shares the claim. When another
 * target holds an axis it needs, the gesture is refused: it tells nothing until its end, as a tap
 * tells nothing, and doesn't retry. Of nested draggables the innermost claims first: a pointer's
 * moves reach the targets it went down on innermost first, and each is handled inside its event
 * (ADR-0032). With `claim: false` the drag only counts in the Drag activity. Either is taken before
 * `handlers.on` hears the `"start"`, and given back at the gesture's `"end"`, before it hears that,
 * or when the Scope closes mid-gesture (ADR-0019, *Amendment (#29)*), so a throw from `on` can't keep
 * it. A Stale gesture's end is the one cold-path log: `wardic.drag: stale gesture` with its rule.
 *
 * Velocity is the pointer's per axis over the gesture's last 100 ms (Motion's `getVelocity`,
 * `Velocity.trailing`), on every sample; the `"end"` sample counts the release point too
 * (ADR-0004, *Amendment (#139)*). It's read from event `timeStamp`s, so the recognizer needs
 * no `Clock` — only `InputSource`.
 */
export const watchDrag = (
  target: unknown,
  { axis = "xy", claim = true, lock = false }: DragOptions,
  handlers: InputFeed.Handlers<Drag.Sample>,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
  const attributes = { threshold: THRESHOLD, velocityWindowMs: VELOCITY_WINDOW_MS }
  const axisAt = axisAtOf(axis)
  const fold = Bool.match(lock, { onTrue: () => lockedStep, onFalse: () => step })
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

    // Added first, so it runs last: after the feed has stopped.
    yield* Effect.addFinalizer(() => Effect.sync(release))
    yield* watchFeed(
      "wardic.drag",
      attributes,
      input.pointer(target),
      () => {
        const state = MutableRef.make(initState)
        return (event) => {
          const [next, samples] = fold(MutableRef.get(state), event)
          MutableRef.set(state, next)
          Arr.forEach(samples, admit)
          return true
        }
      },
      handlers,
    )
  })
}

/**
 * A pan's sample (#273, ADR-0047): a drag's, or its session's start (`"session"`, Motion's
 * `onPanSessionStart`): at a **Primary pointer**'s down on the target, at its point, with no offset,
 * delta or velocity.
 */
export interface PanSample extends Omit<Drag.Sample, "phase"> {
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
  const [next, samples] = step(state, event)
  if (event.type !== "down") return [next, samples]
  if (next === state) return [next, samples]
  return [next, Arr.append(samples, sessionOf(event))]
}

/**
 * Recognize a pan on `target` (#273, ADR-0047, Motion's pan gesture): its session's start at each
 * **Primary pointer**'s down, then a drag's `"start"` past its threshold, a `"move"` at each move, and
 * an `"end"` at the release, a cancel or a lost release, for a pan that started. It moves nothing.
 *
 * A pan takes no **Drag claim**: it never stops a drag, nested or not, and none stops it. Once
 * started it counts in the **Drag activity** until its end, so a press it took over ends as neither
 * a tap nor a cancel, and no hover starts meanwhile. That's Wardic's rule, not Motion's: Motion's pan
 * is invisible to its drag lock, so a swipe that's let go over a tappable element taps it too (ADR-0047).
 */
export const pan = (target: unknown): Stream.Stream<PanSample, never, InputSource.InputSource> =>
  streamOf<PanSample, InputSource.InputSource>((handlers) => watchPan(target, handlers))

/**
 * Watch pans on `target` (#318, ADR-0055): `handlers.on` told each of {@link pan}'s samples inside the pointer
 * event's dispatch, while the Scope is open. A started pan's count in the **Drag activity** is held
 * from its `"start"` to its `"end"`, and given back when the Scope closes on one still going. Tier 2.
 */
export const watchPan = (target: unknown, handlers: InputFeed.Handlers<PanSample>): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
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
        return (event) => {
          const [next, samples] = panStep(MutableRef.get(state), event)
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
