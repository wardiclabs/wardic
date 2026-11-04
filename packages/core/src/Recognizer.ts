/**
 * The `Recognizer` module: CONTEXT.md's Recognizers, each a `Stream` of a gesture's state from an
 * Environment's input: `hover`, `press`, `focus` and `inView`. The pointer's drag and pan are
 * `DragRecognizer`'s (#548), so a page that doesn't drag ships none of their fold.
 *
 * Each is also a watch (#318, ADR-0055): `watchHover`, `watchPress`, `watchFocus` and
 * `watchInView` run a callback inside each event's dispatch while a Scope is open, with no fiber or
 * Stream of their own. The Streams are built over them.
 */
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
import * as DragActivity from "./DragActivity.ts"
import * as InputFeed from "./InputFeed.ts"
import * as InputSource from "./InputSource.ts"
import * as PressClaims from "./PressClaims.ts"
import * as Probe from "./Probe.ts"
import { tracedScoped } from "./internal/tracing.ts"
import { streamOf, watchFeed } from "./internal/watch.ts"

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
const isUnpressedMove: Predicate.Predicate<InputSource.PointerLikeEvent> = /*#__PURE__*/ Predicate.and(ofType("move"), (event) => Bool.not(event.pressed))

/** Whether `event` ends a held pointer's press: its release, its cancel, or a move with no button pressed. */
const endsPress: Predicate.Predicate<InputSource.PointerLikeEvent> = /*#__PURE__*/ Predicate.some([ofType("up"), ofType("cancel"), isUnpressedMove])

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
      // An adopted down's pointer went down elsewhere (#431): it holds nothing here.
      Match.when({ adopted: true }, () => s),
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
export const watchHover: (target: unknown, handlers: HoverHandlers) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> = /*#__PURE__*/ Effect.fnUntraced(
  function* (target: unknown, handlers: HoverHandlers) {
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
 * No press starts while a drag is active, nor while a key holds one (#427), nor from a down a press
 * inside claimed (a **Press claim**, #439). A second down from the owner (a lost release) keeps it
 * pressed. Each of the owner's events notes whether a drag is active (#257).
 */
const pointerStep = (activity: DragActivity.Shape, claims: PressClaims.Shape, target: unknown) => (s: PressState, e: InputSource.PointerLikeEvent): PressState =>
  Match.value(e).pipe(
    Match.when(Predicate.not(InputSource.isPrimaryPointer), () => s),
    // An adopted down's pointer went down elsewhere (#431): it presses nothing here.
    Match.when({ adopted: true }, () => s),
    Match.when({ type: "down" }, (down) =>
      Bool.match(Bool.or(Bool.or(isPressed(s), activity.isDragActive()), claims.markOf(down, target) === "claimed"), {
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
 * Whether a key reaches the target's press (#427, #439): one from the target itself that nothing took
 * first, or one from inside that a press inside started from and didn't claim, as Motion's keyboard
 * press reaches pressable ancestors. A press inside may have taken that key (Space's, `takeSpace`): it
 * still reaches.
 */
const reachesPress = (e: InputSource.KeyboardLikeEvent, claims: PressClaims.Shape, target: unknown): boolean => {
  if (e.fromTarget) return Bool.not(e.handled)
  return claims.markOf(e, target) === "pressed"
}

/**
 * Whether a key's down starts a **Keyboard press** (#427): a pressing key, not a repeat, that reaches the
 * target's press, with no press held and no drag active.
 */
const startsKeyPress = (s: PressState, e: InputSource.KeyboardLikeEvent, activity: DragActivity.Shape, claims: PressClaims.Shape, target: unknown): boolean =>
  Bool.every([e.type === "down", Bool.not(e.repeat), Bool.not(isPressed(s)), Bool.not(activity.isDragActive()), reachesPress(e, claims, target)])

/**
 * Press's key step (#427): a pressing key's down starts a **Keyboard press**, and the same key's up
 * ends it, noting a drag active then. Other keys, and other keys' ups, change nothing.
 */
const keyStep = (activity: DragActivity.Shape, claims: PressClaims.Shape, target: unknown) => (s: PressState, e: InputSource.KeyboardLikeEvent): PressState => {
  const key = pressKeyOf(e)
  if (Predicate.isNull(key)) return s
  if (startsKeyPress(s, e, activity, claims, target)) return { owner: null, key, dragged: false }
  return Bool.match(Bool.and(e.type === "up", key === s.key), {
    onTrue: (): PressState => ({ owner: null, key: null, dragged: Bool.or(s.dragged, activity.isDragActive()) }),
    onFalse: () => s,
  })
}

/**
 * Press's focus step (#427): a blur cancels a **Keyboard press**, the target's own or one inside it, where
 * the key of a press that reached it from inside came from (#439); a pointer's press goes on.
 */
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
 *
 * `propagate` (#439, Motion's `propagate.tap`): whether its presses reach its pressable ancestors, read at
 * each press's start. `false` takes a **Press claim** on the down or the key it starts from, so no
 * ancestor's press starts from it. Default `true`.
 */
export interface PressOptions {
  readonly keys?: boolean | undefined
  readonly propagate?: boolean | LazyArg<boolean> | undefined
}

/** Whether a press with `options` propagates now: its `propagate`, read now, else `true`. */
const propagatesOf = (options: PressOptions | undefined): LazyArg<boolean> => {
  const propagate = UndefinedOr.map(options, (o) => o.propagate)
  if (Predicate.isUndefined(propagate)) return constTrue
  if (Predicate.isBoolean(propagate)) return constant(propagate)
  return propagate
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
 * with its own step. Each press marks the down or the key it starts from in the page's **Press claims**
 * (#439), claimed when it doesn't propagate. `handlers.onEnd` is told once every feed it watches
 * throughout has run out. Tier 2.
 *
 * An Environment that says where focus is (`InputSource.focusWithin`, #460) has its keys watched only
 * while focus is within the target, as Motion's press listens for keys only once its element has focus:
 * from a `focus` to the `blur` after, or from the start when focus is already there. An element at
 * rest holds its focus feed alone.
 */
export const watchPress: (
  target: unknown,
  handlers: InputFeed.Handlers<PressEvent>,
  options?: PressOptions,
) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> = /*#__PURE__*/ Effect.fnUntraced(
  function* (target: unknown, handlers: InputFeed.Handlers<PressEvent>, options?: PressOptions) {
    yield* Effect.logDebug("wardic.press: watch")
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    const claims = yield* PressClaims.PressClaims
    const keys = UndefinedOr.match(options, { onUndefined: constTrue, onDefined: (o) => o.keys !== false })
    const propagates = propagatesOf(options)
    // A press's start marks what it started from (#439): claimed when it doesn't propagate.
    const marking = (event: PressClaims.Markable, told: PressEvent): void => {
      if (told.phase === "start") claims.mark(event, target, Bool.not(propagates()))
    }
    const focusWithin = input.focusWithin
    const state = MutableRef.make(noPress)
    const feeds = MutableRef.make(feedsWatched(keys, Predicate.isNotUndefined(focusWithin)))
    // The keys while focus is within the target (#460): made at the first focus, let go with the watches.
    let keysNow: InputFeed.Switch | undefined
    const closeKeys = (): void => {
      if (Predicate.isNotUndefined(keysNow)) keysNow.close()
    }
    const watching: Pick<InputFeed.Handlers<never>, "onDefect" | "onEnd" | "onStop"> = {
      onDefect: handlers.onDefect,
      onEnd: () => {
        MutableRef.set(feeds, MutableRef.get(feeds) - 1)
        if (MutableRef.get(feeds) === 0) UndefinedOr.map(handlers.onEnd, (onEnd) => onEnd())
      },
      onStop: closeKeys,
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
    yield* InputFeed.watchWith(input.pointer(target), step(pointerStep(activity, claims, target), pointerPressOf, marking), watching)
    if (Bool.not(keys)) return
    const keyTaken = (event: InputSource.KeyboardLikeEvent, told: PressEvent): void => {
      marking(event, told)
      takeSpace(event, told)
    }
    const onKey = step(keyStep(activity, claims, target), keyPressOf, keyTaken)
    const onFocus = step(focusStep, blurPressOf, constVoid)
    if (Predicate.isUndefined(focusWithin)) {
      yield* InputFeed.watchWith(input.keyboard(target), onKey, watching)
      yield* InputFeed.watchWith(input.focus(target), onFocus, watching)
      return
    }
    // Keys only while focus is within the target (#460), from a focus, or from now when it already is.
    const openKeys = (): void => {
      if (Predicate.isUndefined(keysNow)) keysNow = InputFeed.switched(input.keyboard(target), onKey(), handlers.onDefect)
      keysNow.open()
    }
    const blurs = onFocus()
    const focuses = (event: InputSource.FocusLikeEvent): boolean => {
      if (event.type === "focus") openKeys()
      // A blur first ends a Keyboard press it cancels, then lets the keys go.
      const goOn = blurs(event)
      if (event.type === "blur") closeKeys()
      return goOn
    }
    yield* InputFeed.watchWith(input.focus(target), () => focuses, watching)
    if (focusWithin(target)) openKeys()
  },
  (self) => tracedScoped(self, "wardic.press"),
)

/**
 * How many feeds a press watches throughout (#427, #460), each one's end counted for `onEnd`: its
 * pointer; with **Keyboard presses**, its focus; and its keys too, unless they're held only while focus
 * is within the target.
 */
const feedsWatched = (keys: boolean, keysOnFocus: boolean): number => {
  if (Bool.not(keys)) return 1
  if (keysOnFocus) return 2
  return 3
}

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
 * Space's down starting a **Keyboard press** is taken where its target does nothing with it (#427),
 * so the Environment's own response to it doesn't run beside the press. A target with its own action
 * for it keeps it, so that action still runs: taking the key could stop it.
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

/**
 * Focus's fold: the target's own focus and blur, a focus counted when it shows or `visibleOnly` is off.
 * A focus or blur inside the target (#439) changes nothing.
 */
const ownFocusFold = (visibleOnly: boolean): Fold<boolean, InputSource.FocusLikeEvent> => ({
  initial: false,
  step: (focused, e) => {
    if (e.fromTarget === false) return focused
    return Bool.and(e.type === "focus", Bool.or(Bool.not(visibleOnly), e.visible !== false))
  },
  active: identity,
})

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
      statesOf(ownFocusFold(visibleOnly), handlers.on, false),
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
