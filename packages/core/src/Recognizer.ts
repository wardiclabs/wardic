/**
 * Recognizers: a gesture's state from an Environment's input. `hover`, `press`, `focus` and `inView` are
 * each a Stream of whether their gesture is on; `hoverEvents`, `pressEvents` and `inViewEvents` tell each
 * start and end with the event behind it. Each has a watch too, `watchHover`, `watchPress`, `watchFocus`
 * and `watchInView`, which calls you inside each event's dispatch while a Scope is open, with no fiber of
 * its own: a binding's gestures run on these. Drags and pans are `DragRecognizer`'s.
 *
 * @example
 * import * as Recognizer from "@wardic/core/Recognizer"
 *
 * yield* Recognizer.watchPress(button, {
 *   on: ({ phase }) => {
 *     if (phase === "tap") submit()
 *   },
 * })
 */
// CONTEXT.md's Recognizers. Drag and pan are `DragRecognizer`'s (#548), so an app that doesn't drag
// ships none of their fold. The watches are #318's (ADR-0055); the Streams are built over them.
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
import * as Iter from "effect/Iterable"
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
 * A fold's edges as a watch's handler (#257, #318): `on` told each change of whether it's
 * active, as `out` makes it of the state, the event that turned it and whether it's on now; an event
 * that changes nothing tells nothing. With `once`, done at the first that's on.
 */
const edgesOf =
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

/** A gesture's start or end, and the event that turned it. */
// #257.
export interface Edge {
  /** Whether the gesture is on now. */
  readonly active: boolean
  /** The event that turned it: its `x` and `y`, less its `scroll`, say where the pointer was on the screen. */
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
 * Whether the pointer is over `target`: `true` once it comes over, `false` once it leaves, each change
 * once. A leave while a pointer that pressed `target` is still held waits for its release. A touch never
 * hovers, and no hover starts while a drag is active.
 */
// After Motion's `hover` (ADR-0019).
export const hover = (target: unknown): Stream.Stream<boolean, never, InputSource.InputSource> =>
  Stream.map(hoverEvents(target), activeOf)

/** `hover`'s starts and ends with the event that turned each, as Motion's `onHoverStart` and `onHoverEnd`. */
// #257. A Stream over `watchHover`.
export const hoverEvents = (target: unknown): Stream.Stream<Edge, never, InputSource.InputSource> =>
  streamOf<Edge, InputSource.InputSource>((handlers) => watchHover(target, handlers))

/** `watchHover`'s handlers: `on`, each start and end, and `onMove`, each move between them. */
// #397.
export interface HoverHandlers extends InputFeed.Handlers<Edge> {
  /**
   * Each move of the pointer over the target while the hover is on, which Motion's hover doesn't have. A
   * touch never hovers, and a held pointer whose leave waits for its release isn't over the target, so
   * neither moves it.
   */
  // #397: Wardic's own.
  readonly onMove?: ((event: InputSource.PointerLikeEvent) => void) | undefined
}

/**
 * Watches hover on `target` while the Scope is open: `handlers.on` hears each start and end, as
 * `hoverEvents` tells them, and `handlers.onMove` each move over it while the hover is on, inside the
 * pointer event's dispatch. A throw from either goes to `handlers.onDefect`.
 *
 * @example
 * yield* Recognizer.watchHover(card, {
 *   on: ({ active }) => setHovered(active),
 *   onMove: (event) => follow(event.x, event.y),
 * })
 */
// #318, ADR-0055, #397: no fiber and no Stream, a scoped subscription to the target's pointer feed. Tier
// 2, for bindings.
export const watchHover: (target: unknown, handlers: HoverHandlers) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> = /*#__PURE__*/ Effect.fnUntraced(
  function* (target: unknown, handlers: HoverHandlers) {
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    const fold = hoverFold(activity)
    const handle = UndefinedOr.match(handlers.onMove, {
      onUndefined: () => edgesOf(fold, edgeOf, handlers.on, false),
      onDefined: (onMove) => hoverHandleOf(fold, handlers.on, onMove),
    })
    yield* watchFeed("wardic.hover", {}, input.pointer(target), handle, handlers)
  })

/** A watch's handlers over many targets: `on`, each target's start and end, with the target. */
// #665's PR 5 (Q56).
export interface AmongHandlers<A> extends Pick<InputFeed.Handlers<never>, "onDefect" | "onEnd" | "onStop"> {
  readonly on: (target: unknown, value: A) => void
}

/** An InputSource's feed over many targets, or a defect naming it: an Environment without one can't watch many targets as one. */
const amongFeed = <A>(feed: A | undefined, name: string): Effect.Effect<A> =>
  UndefinedOr.match(feed, {
    onUndefined: () => Effect.die(new Error(`wardic: the Environment's InputSource has no \`${name}\`, which a gesture over many targets needs`)),
    onDefined: Effect.succeed,
  })

/**
 * Each target's state in a watch over many targets: held weakly by a target that's an object, so a
 * target gone mid-gesture (an element removed under the pointer, which hears no leave) keeps nothing.
 */
interface TargetStates<S> {
  readonly get: (target: unknown) => S | undefined
  readonly set: (target: unknown, state: S) => void
  readonly delete: (target: unknown) => void
}

/** A {@link TargetStates}: a `WeakMap` for objects, a `Map` for the rest (a test's names). */
// Per event over a target: statements.
const targetStates = <S>(): TargetStates<S> => {
  const objects = new WeakMap<object, S>()
  const others = new Map<unknown, S>()
  return {
    get: (target) => {
      if (Predicate.isObject(target)) return objects.get(target)
      return others.get(target)
    },
    set: (target, state) => {
      if (Predicate.isObject(target)) {
        objects.set(target, state)
        return
      }
      others.set(target, state)
    },
    delete: (target) => {
      if (Predicate.isObject(target)) {
        objects.delete(target)
        return
      }
      others.delete(target)
    },
  }
}

/** Whether a hover's state is at rest: no pointer over its target or holding it, so it needs none kept. */
const hoverAtRest = (state: HoverState): boolean => {
  if (state.inside) return false
  if (state.deferred) return false
  return Predicate.isNull(state.held)
}

/**
 * Watches hover on many targets from one source while the Scope is open: `memberOf(node)` names the
 * target a node is, `Option.none()` for none, and `handlers.on` hears each target's starts and ends, with
 * it, as `watchHover` would tell it of its own events. A target a pointer has never touched keeps
 * nothing, and one that's an object is held weakly.
 *
 * @example
 * yield* Recognizer.watchHoverAmong((node) => Option.fromUndefinedOr(tiles.get(node)), {
 *   on: (tile, { active }) => lift(tile, active),
 * })
 */
// #665's PR 5 (Q56): a Batch's members, over the InputSource's `pointerAmong`. Hover's fold, a state a
// target, made at its first event and dropped at rest, held weakly. Tier 2, for bindings.
export const watchHoverAmong: (memberOf: (node: unknown) => Option.Option<unknown>, handlers: AmongHandlers<Edge>) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> = /*#__PURE__*/ Effect.fnUntraced(
  function* (memberOf: (node: unknown) => Option.Option<unknown>, handlers: AmongHandlers<Edge>) {
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    const among = yield* amongFeed(input.pointerAmong, "pointerAmong")
    const fold = hoverFold(activity)
    const handle = (): ((told: InputSource.TargetEvent<InputSource.PointerLikeEvent>) => boolean) => {
      const states = targetStates<HoverState>()
      // Per pointer event over a target: statements.
      return ({ target, event }) => {
        const was = UndefinedOr.match(states.get(target), { onUndefined: () => noHover, onDefined: identity })
        const next = fold.step(was, event)
        states.set(target, next)
        if (hoverAtRest(next)) states.delete(target)
        const active = fold.active(next)
        if (active !== fold.active(was)) handlers.on(target, { active, event })
        return true
      }
    }
    yield* watchFeed("wardic.hover", { among: true }, among(memberOf), handle, handlers)
  },
)

/** Whether `event` moves a pointer over the target while `state`'s hover is on (#397). */
const movesOver = (state: HoverState, event: InputSource.PointerLikeEvent): boolean =>
  Bool.and(Bool.and(state.inside, event.type === "move"), Bool.and(event.onTarget, event.kind !== "touch"))

/** Hover's edges, as {@link edgesOf}'s, and each move over the target between them (#397). */
const hoverHandleOf =
  (fold: Fold<HoverState, InputSource.PointerLikeEvent>, on: (edge: Edge) => void, onMove: (event: InputSource.PointerLikeEvent) => void) =>
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

/** An edge of the state it changed to (#257). */
const edgeOf = (_next: unknown, event: InputSource.PointerLikeEvent, active: boolean): Edge => ({ active, event })

/** Whether an edge turned its gesture on. */
const activeOf = (edge: Edge): boolean => edge.active

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
// An if chain, not `Bool.every`, which reads every check: `reachesPress` read the press claims on every
// key event, though most stop at the first check (#618, H1).
const startsKeyPress = (s: PressState, e: InputSource.KeyboardLikeEvent, activity: DragActivity.Shape, claims: PressClaims.Shape, target: unknown): boolean => {
  if (e.type !== "down") return false
  if (e.repeat) return false
  if (isPressed(s)) return false
  if (activity.isDragActive()) return false
  return reachesPress(e, claims, target)
}

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
 * Whether `target` is pressed: `true` once the primary pointer goes down on it, `false` once it's released
 * or cancelled, wherever that happens, or at its first move with no button after a lost release. A key
 * presses it too, Enter or Space, held while the key is down. No press starts while a drag is active.
 * Each change once.
 */
// A **Held pointer**'s release reaches the target; a **Keyboard press** (#427); ADR-0019.
export const press = (target: unknown, options?: PressOptions): Stream.Stream<boolean, never, InputSource.InputSource> =>
  Stream.map(pressEvents(target, options), pressing)

/**
 * How a press began or ended, as Motion's press: `"start"` at its down; `"tap"`, a release on the target
 * or inside it, or a pressed key coming up; `"cancel"`, a release elsewhere, a cancel, a lost release, or
 * a blur that ends a key's press; `"dragged"`, an end after a drag took over, which Motion tells as
 * neither.
 */
// #257; a **Keyboard press** (#427).
export type PressPhase = "start" | "tap" | "cancel" | "dragged"

/**
 * A press's start or end, and the event it came with: a pointer's (`input: "pointer"`), or a key's, or
 * the blur that cancelled a key's press (`input: "keyboard"`).
 */
// #257; a **Keyboard press** (#427).
export type PressEvent =
  | { readonly phase: PressPhase; readonly input: "pointer"; readonly event: InputSource.PointerLikeEvent }
  | { readonly phase: PressPhase; readonly input: "keyboard"; readonly event: InputSource.KeyboardLikeEvent | InputSource.FocusLikeEvent }

/** A press's options. */
// #427, #439.
export interface PressOptions {
  /**
   * `false`: no key presses it, for a target whose Enter and Space are someone else's: a Reorder item's,
   * which lift it. Default `true`.
   */
  // #427, ADR-0037: **Keyboard presses**.
  readonly keys?: boolean | undefined
  /**
   * Whether its presses reach its pressable ancestors, as Motion's `propagate.tap`, read at each press's
   * start. `false` claims the down or the key it starts from, so no ancestor's press starts from it.
   * Default `true`.
   */
  // #439: a **Press claim**.
  readonly propagate?: boolean | LazyArg<boolean> | undefined
}

/** Whether keys press a target with `options`: its `keys`, else `true`. */
const keysPressOf = (options: PressOptions | undefined): boolean => UndefinedOr.match(options, { onUndefined: constTrue, onDefined: (o) => o.keys !== false })

/**
 * A press's state stepped from `was` to `now` by `event`: when it turned, its edge, `out`'s, marked by
 * `taken` and told `on`; nothing when it didn't.
 */
// Per press event: statements.
const tellPress = <Ev>(
  was: PressState,
  now: PressState,
  event: Ev,
  out: (ended: PressState, e: Ev, active: boolean) => PressEvent,
  taken: (e: Ev, told: PressEvent) => void,
  on: (told: PressEvent) => void,
): void => {
  const active = isPressed(now)
  if (active === isPressed(was)) return
  const told = out(now, event, active)
  taken(event, told)
  on(told)
}

/** Whether a press with `options` propagates now: its `propagate`, read now, else `true`. */
const propagatesOf = (options: PressOptions | undefined): LazyArg<boolean> => {
  const propagate = UndefinedOr.map(options, (o) => o.propagate)
  if (Predicate.isUndefined(propagate)) return constTrue
  if (Predicate.isBoolean(propagate)) return constant(propagate)
  return propagate
}

/**
 * `press`'s starts and ends with how each began or ended, as Motion's `onTapStart`, `onTap` and
 * `onTapCancel`, and a press a drag took over, which Motion tells as neither.
 */
// #257. A Stream over `watchPress`.
export const pressEvents = (target: unknown, options?: PressOptions): Stream.Stream<PressEvent, never, InputSource.InputSource> =>
  streamOf<PressEvent, InputSource.InputSource>((handlers) => watchPress(target, handlers, options))

/**
 * Watches presses on `target` while the Scope is open: `handlers.on` hears each start and end, as
 * `pressEvents` tells them, inside the event's dispatch, as `watchHover`'s. A pointer presses it, or a key.
 * `handlers.onEnd` is told once every feed it watches has run out.
 *
 * Where the Environment says where focus is, its keys are watched only while focus is within the target,
 * as Motion's press listens for keys once its element has focus: an element at rest holds only its focus
 * feed.
 */
// #318, ADR-0055. One fold over the target's pointer, keys and focus, each feed watched with its own
// step; a **Keyboard press** (#427). Each press marks the down or the key it starts from in the runtime's
// **Press claims** (#439), claimed when it doesn't propagate. Keys while focus is within:
// `InputSource.focusWithin` (#460), from a `focus` to the `blur` after, or from the start when focus is
// already there. Tier 2.
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
    const keys = keysPressOf(options)
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
        tellPress(was, now, event, out, taken, handlers.on)
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

/**
 * Watches presses on many targets from one source while the Scope is open: `memberOf(node)` names the
 * target a node is, `Option.none()` for none, and `handlers.on` hears each target's starts and ends, with
 * it, as `watchPress` would tell it of its own events. A focused target's Enter and Space press it, its
 * keys heard only while focus is within it, through the InputSource's `focusAmong`, which tells a focus
 * already within one as it starts; without one, only pointers press. A target with no press held keeps
 * nothing.
 *
 * @example
 * yield* Recognizer.watchPressAmong((node) => Option.fromUndefinedOr(tiles.get(node)), {
 *   on: (tile, { phase }) => {
 *     if (phase === "tap") open(tile)
 *   },
 * })
 */
// #665's PR 5 (Q56, Q57): a Batch's members, over `pointerAmong` and `focusAmong`. Press's steps, a state a
// target, made at its first event and dropped once no press is held; its **Press claims** marked per
// target (#439); each focused target's keys a switch of its own (#460). Tier 2, for bindings.
export const watchPressAmong: (
  memberOf: (node: unknown) => Option.Option<unknown>,
  handlers: AmongHandlers<PressEvent>,
  options?: PressOptions,
) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> = /*#__PURE__*/ Effect.fnUntraced(
  function* (memberOf: (node: unknown) => Option.Option<unknown>, handlers: AmongHandlers<PressEvent>, options?: PressOptions) {
    yield* Effect.logDebug("wardic.press: watch")
    const input = yield* InputSource.InputSource
    const activity = yield* DragActivity.DragActivity
    const claims = yield* PressClaims.PressClaims
    const pointer = yield* amongFeed(input.pointerAmong, "pointerAmong")
    const focusAmong = input.focusAmong
    const keys = Bool.and(keysPressOf(options), Predicate.isNotUndefined(focusAmong))
    const propagates = propagatesOf(options)
    // Each target with a press held, and each focused target's keys.
    const states = targetStates<PressState>()
    const keysOf = new Map<unknown, InputFeed.Switch>()
    // Its pointer, and with keys its focus: each one's end counted for `onEnd`.
    const feeds = MutableRef.make(feedsWatched(keys, true))
    const onEnd = (): void => {
      MutableRef.set(feeds, MutableRef.get(feeds) - 1)
      if (MutableRef.get(feeds) === 0) UndefinedOr.map(handlers.onEnd, (end) => end())
    }
    // Told once, as the watch stops: with its pointer's.
    const onStop = (): void => {
      Iter.forEach(keysOf, ([, keysNow]) => keysNow.close())
      keysOf.clear()
      UndefinedOr.map(handlers.onStop, (stop) => stop())
    }
    /** `target`'s event stepped by `next`: its edge told, and its state kept while a press is held. */
    // Per event over a target: statements.
    const stepOn = <Ev>(target: unknown, event: Ev, next: (s: PressState, e: Ev) => PressState, out: (ended: PressState, e: Ev, active: boolean) => PressEvent, taken: (e: Ev, told: PressEvent) => void): void => {
      const was = UndefinedOr.match(states.get(target), { onUndefined: () => noPress, onDefined: identity })
      const now = next(was, event)
      states.set(target, now)
      if (Bool.not(isPressed(now))) states.delete(target)
      tellPress(was, now, event, out, taken, (told) => handlers.on(target, told))
    }
    /** A press's start on `target` marks what it started from (#439): claimed when it doesn't propagate. */
    const markingOn = (target: unknown) => (event: PressClaims.Markable, told: PressEvent): void => {
      if (told.phase === "start") claims.mark(event, target, Bool.not(propagates()))
    }
    const onPointer = (): ((told: InputSource.TargetEvent<InputSource.PointerLikeEvent>) => boolean) => ({ target, event }) => {
      stepOn(target, event, pointerStep(activity, claims, target), pointerPressOf, markingOn(target))
      return true
    }
    yield* InputFeed.watchWith(pointer(memberOf), onPointer, { onDefect: handlers.onDefect, onEnd, onStop })
    if (Bool.not(keys)) return
    if (Predicate.isUndefined(focusAmong)) return
    const closeKeys = (target: unknown): void => {
      UndefinedOr.map(keysOf.get(target), (keysNow) => keysNow.close())
      keysOf.delete(target)
    }
    // A target's keys only while focus is within it (#460), from its focus to its blur.
    const openKeys = (target: unknown): void => {
      if (keysOf.has(target)) return
      const marking = markingOn(target)
      const keyTaken = (event: InputSource.KeyboardLikeEvent, told: PressEvent): void => {
        marking(event, told)
        takeSpace(event, told)
      }
      const keysNow = InputFeed.switched(input.keyboard(target), (event) => stepOn(target, event, keyStep(activity, claims, target), keyPressOf, keyTaken), handlers.onDefect)
      keysOf.set(target, keysNow)
      keysNow.open()
    }
    const onFocus = (): ((told: InputSource.TargetEvent<InputSource.FocusLikeEvent>) => boolean) => ({ target, event }) => {
      if (event.type === "focus") openKeys(target)
      // A blur first ends a Keyboard press it cancels, then lets the keys go.
      stepOn(target, event, focusStep, blurPressOf, constVoid)
      if (event.type === "blur") closeKeys(target)
      return true
    }
    yield* InputFeed.watchWith(focusAmong(memberOf), onFocus, { onDefect: handlers.onDefect, onEnd })
  },
  (self) => tracedScoped(self, "wardic.press"),
)

/** A pointer's press edge, with how it began or ended. */
const pointerPressOf = (next: PressState, event: InputSource.PointerLikeEvent, active: boolean): PressEvent => ({
  phase: Bool.match(active, { onTrue: (): PressPhase => "start", onFalse: () => endOf(next, event) }),
  input: "pointer",
  event,
})

/** A **Keyboard press**'s edge (#427): its start at its key's down, its end at its up, a tap unless a drag took it over. */
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
 * Whether `target` has focus: `true` at its focus, `false` at its blur, each change once. A focus or blur
 * inside it changes nothing. With `visible: true`, as Motion's `whileFocus`, only a focus the Environment
 * shows counts: a keyboard's, not a click's.
 */
// #273: `FocusLikeEvent.visible`. #439: a focus inside.
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

/** `focus`'s options. */
// #273.
export interface FocusOptions {
  /** `true`: only a focus the Environment shows counts, a keyboard's, not a click's. Default `false`. */
  readonly visible?: boolean
}

/**
 * Watches focus on `target` while the Scope is open: `handlers.on` hears whether it has focus at first,
 * then each change, as `focus` tells them, inside the focus event's dispatch.
 */
// #318, ADR-0055. Tier 2.
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
 * `inView`'s options, as Motion's `viewport`: the Probe's `root`, `margin` and `amount`, and `once`.
 */
// #273.
export interface InViewOptions extends Probe.IntersectionOptions {
  /** `true`: settled at its first entry, in view from then on. Default `false`. */
  readonly once?: boolean | undefined
}

/** The Probe's options of `options`, with no `once`. */
const intersectionOf = ({ once: _once, ...options }: InViewOptions): Probe.IntersectionOptions => options

/** Whether an intersection is in. */
const intersecting = (intersection: Probe.Intersection): boolean => intersection.intersecting

/**
 * Whether `target` is in view, by the Probe: its first report, then each change, against `options`'
 * root, margin and amount. With `once: true` the Stream ends at its first `true`, and its observer
 * with it, so a target seen once never goes back to `false`.
 *
 * @example
 * Recognizer.inView(section, { amount: 0.5, once: true })
 */
// A Stream over a watch (#318), as `focus`'s: the `wardic.inView` span and log, and only changes after
// the first report.
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

/** A target coming into view or leaving it. */
// #273.
export interface ViewEdge {
  /** Whether it's in view now. */
  readonly active: boolean
  /** The platform's record of it, which core never reads: a binding hands it to an app's callback. */
  readonly raw?: unknown
}

/**
 * `inView`'s entries and leaves, with the platform's record of each, as Motion's `onViewportEnter` and
 * `onViewportLeave`: a target that starts out of view tells nothing until it enters. With `once: true` it
 * ends at its first entry, with no leave.
 */
// #273.
export const inViewEvents = (target: unknown, options: InViewOptions = {}): Stream.Stream<ViewEdge, never, Probe.Probe> =>
  streamOf<ViewEdge, Probe.Probe>(
    (handlers) => watchInView(target, options, handlers),
    (edge) => Bool.and(options.once === true, edge.active),
  )

/**
 * Watches `target`'s view while the Scope is open: `handlers.on` hears each entry and leave, as
 * `inViewEvents` tells them; with `once`, the first entry only, and then its observer goes.
 */
// #318, ADR-0055. Tier 2.
export const watchInView = (
  target: unknown,
  options: InViewOptions,
  handlers: InputFeed.Handlers<ViewEdge>,
): Effect.Effect<void, never, Scope.Scope | Probe.Probe> =>
  Effect.flatMap(Probe.Probe, (probe) =>
    watchFeed(
      "wardic.inView",
      {},
      probe.observeIntersection(target, intersectionOf(options)),
      edgesOf(booleanFold(intersecting), viewEdgeOf, handlers.on, options.once === true),
      handlers,
    ))

/** An in-view edge of the intersection that turned it. */
const viewEdgeOf = (_next: boolean, intersection: Probe.Intersection, active: boolean): ViewEdge => ({ active, raw: intersection.raw })
