/**
 * Input from the Environment: the `InputSource` service, which gives each target's pointer, keys and
 * focus as Input feeds, and the events they carry, in core's own terms, so no recognizer reads a
 * platform's events. An Environment provides it, mapping its platform's events onto these, as
 * `@wardic/dom` does. A target is the Environment's own, opaque to core: an element, a node in a scene
 * graph.
 * `heldPointer` is how an Environment builds a target's pointer feed: once a pointer goes down on the
 * target, its moves and its release keep reaching it wherever they land.
 *
 * @example
 * import * as InputSource from "@wardic/core/InputSource"
 *
 * const input = yield* InputSource.InputSource
 * yield* InputFeed.watch(input.pointer(card), {
 *   on: (event) => {
 *     if (event.type === "down" && InputSource.isPrimaryPointer(event)) grab(event.x, event.y)
 *   },
 * })
 */
// Input feeds (ADR-0004, ADR-0019, #318); `heldPointer` is the Held pointer contract every Environment
// builds its pointer feeds from (ADR-0028, decision 11).
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import { constFalse, constTrue, constVoid } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as InputFeed from "./InputFeed.ts"
import * as Outbox from "./internal/outbox.ts"
import type * as Point from "./Point.ts"

/**
 * A pointer's event, in core's terms: a mouse's, a pen's or a finger's. An Environment maps its
 * platform's events onto these, so a native or a canvas Environment gives the same.
 */
export interface PointerLikeEvent {
  /**
   * What happened: a press (`"down"`), a move, a release (`"up"`), a cancel by the platform, or the
   * pointer coming over the target (`"enter"`) or going off it (`"leave"`).
   */
  readonly type: "down" | "move" | "up" | "cancel" | "enter" | "leave"
  /** Which pointer: the same on all its events while it's down. */
  readonly pointerId: number
  /** Where it is across, in the Environment's coordinates, with a held pointer's `scroll` counted in. */
  readonly x: number
  /** Where it is down, in the Environment's coordinates, with a held pointer's `scroll` counted in. */
  readonly y: number
  /**
   * Whether any button is down. A pressed pointer's moves are pressed, so a held pointer's move with
   * none pressed means its release was lost: a drag ends there.
   */
  // A **Stale gesture** (ADR-0019).
  readonly pressed: boolean
  /** When it happened, in ms. */
  readonly timeStamp: number
  /** What the pointer is: a mouse, a pen, a finger. */
  // A **Pointer kind** (#189).
  readonly kind: PointerKind
  /** The button whose state it changed: `"none"` when none did, as on a move. */
  // #189.
  readonly button: PointerButton
  /**
   * Whether it's the first of its kind in contact: the mouse always is, a second finger isn't. It
   * isn't the primary pointer itself: `isPrimaryPointer` decides that, from it.
   */
  // #189: the **Primary pointer**.
  readonly primary: boolean
  /**
   * The scroll its hold has counted into `x` and `y` since its down: zero for a pointer that isn't
   * held, or held with nothing scrolled. `x - scroll.x` is where the pointer is on the screen.
   * `heldPointer` sets it.
   */
  // ADR-0019, *Amendment (Reorder)*; #257.
  readonly scroll: Point.Point
  /**
   * Whether it landed on the target or inside it: the target's own events do, and a held pointer's
   * events from elsewhere say where they landed. A release that does is a tap; one that
   * doesn't cancels it.
   */
  // #257: Motion's press, `isNodeOrChild`.
  readonly onTarget: boolean
  /**
   * The platform's own event this one was mapped from, which core never reads: a binding hands it to an
   * app's gesture callback. A move a scroll made, and a lost release's ending move, carry the pointer's
   * last move's, or its down's before it has moved; never an enter's or a leave's.
   *
   * One platform event that reaches several targets carries the same `raw` on each copy: Press claims
   * find the event by it. An Environment with no platform event hands every target the same event
   * object instead.
   */
  // #273: Motion's `(event, info)` and `lastMoveEvent`; #439: the runtime's **Press claims**.
  readonly raw?: unknown
  /**
   * `true` on a down the target adopted: its pointer went down elsewhere, on a handle or a track, and
   * `InputSource`'s `adoptPointer` handed it to the target, whose feed holds it from there as if it had
   * gone down on the target. Only a drag starts from it; a press, a hover or a pan leaves it out. Absent
   * on every other event, the adopted pointer's later ones included.
   */
  // #431, **Drag controls**.
  readonly adopted?: boolean
}

/** No scroll counted, `{ x: 0, y: 0 }`: shared, so an event that isn't held allocates nothing for it. */
export const NO_SCROLL: Point.Point = { x: 0, y: 0 }

/** What a pointer is, in core's words, `"other"` for a kind core has no rule about. An Environment maps its platform's kinds onto these. */
// A **Pointer kind** (ADR-0036, *Amendment (#189)*).
export type PointerKind = "mouse" | "pen" | "touch" | "other"

/** A pointer's button, in core's words: `"none"` when an event changed no button, `"other"` for one core has no rule about. */
// ADR-0036, *Amendment (#189)*.
export type PointerButton = "main" | "middle" | "secondary" | "other" | "none"

/**
 * A pointer event with a mouse's defaults, for a test's script or an Environment with only a mouse:
 * pointer 1 at (0, 0) at time 0, a primary mouse, its `button` `"main"` on a down or an up and `"none"`
 * otherwise, pressed on a down or a move, no scroll, on the target. A field given wins.
 *
 * @example
 * const move = InputSource.makePointerLikeEvent({ type: "move", x: 40, y: 10 })
 */
// Tier 2 (ADR-0008); ADR-0019.
export const makePointerLikeEvent = (
  init: { readonly type: PointerLikeEvent["type"] } & Partial<Omit<PointerLikeEvent, "type">>,
): PointerLikeEvent => ({
  pointerId: 1,
  x: 0,
  y: 0,
  timeStamp: 0,
  kind: "mouse",
  primary: true,
  button: Match.value(init.type).pipe(
    Match.when(Match.is("down", "up"), (): PointerButton => "main"),
    Match.orElse((): PointerButton => "none"),
  ),
  pressed: Match.value(init.type).pipe(
    Match.when(Match.is("down", "move"), constTrue),
    Match.orElse(constFalse),
  ),
  scroll: NO_SCROLL,
  onTarget: true,
  ...init,
})

/**
 * Whether `event` is the primary pointer's, the only one drags and presses hear: a mouse's with its
 * main button or no button change, or any other pointer that's `primary`. A right-click doesn't drag,
 * and a second finger neither presses nor moves a drag. As Motion's `isPrimaryPointer`; for a
 * recognizer of your own.
 */
// The **Primary pointer**: `motion-dom/src/gestures/utils/is-primary-pointer.ts` @ `16c6122`, over core's
// own fields (ADR-0036, *Amendment (#189)*). Tier 2 (ADR-0008), for custom recognizers (ADR-0019).
export const isPrimaryPointer = (event: PointerLikeEvent): boolean =>
  Match.value(event).pipe(
    Match.when({ kind: "mouse" }, (mouse) => Bool.or(mouse.button === "main", mouse.button === "none")),
    Match.orElse((other) => other.primary),
  )

/**
 * A key, in core's names: the keys core acts on, and `"other"` for the rest. An Environment maps its
 * platform's key names onto these, so no platform's names reach core.
 */
// ADR-0037.
export type Key = "space" | "enter" | "escape" | "left" | "right" | "up" | "down" | "home" | "end" | "other"

/**
 * What a key's target does with it itself, unless something takes it: `"type"`, the key goes into text
 * the target edits; `"activate"`, the target has its own action for it; `"none"`, nothing of its own,
 * though its Environment may. An Environment says it of its own targets, so core knows none of their
 * kinds.
 */
// #427.
export type KeyAction = "type" | "activate" | "none"

/** A key going down or up at a target or inside it, in core's terms. */
// ADR-0037.
export interface KeyboardLikeEvent {
  /** Whether the key went down or up. */
  readonly type: "down" | "up"
  /** Which key. */
  readonly key: Key
  /** Whether it's a held key's repeat. */
  readonly repeat: boolean
  /** When it happened, in ms. */
  readonly timeStamp: number
  /** Whether it came from the target itself, not from something inside it, a text field or a button. */
  readonly fromTarget: boolean
  /** Whether a handler that ran before this one, the app's, already took the key. */
  readonly handled: boolean
  /**
   * Takes the key, so the platform's own response to it, a scroll say, doesn't run: called while
   * handling the event, which arrives inside the platform's dispatch.
   */
  // ADR-0032.
  readonly handle: () => void
  /** What the key's own target does with it: a keyboard press on Space takes the key only where its target does nothing. */
  // #427: a **Keyboard press**.
  readonly action: KeyAction
  /**
   * The platform's own event, which core never reads, as a pointer event's `raw`: a binding hands it to
   * an app's callback. One key that reaches several targets carries the same `raw` on each copy.
   */
  // #427; #439, for the runtime's **Press claims**.
  readonly raw?: unknown
}

/** A target taking or losing focus, in core's terms. */
export interface FocusLikeEvent {
  /** Whether it took focus or lost it. */
  readonly type: "focus" | "blur"
  /** When it happened, in ms. */
  readonly timeStamp: number
  /**
   * Whether it's the target's own focus or blur. `false`: something inside it took or lost focus, which
   * only cancels a keyboard press that reached the target from inside; `Recognizer.focus` counts the
   * target's own only. Absent: the target's own.
   */
  // #439: a **Keyboard press**.
  readonly fromTarget?: boolean
  /** The platform's own event, which core never reads: a blur that cancels a keyboard press hands it to an app's callback. */
  // #427.
  readonly raw?: unknown
  /**
   * Whether the Environment shows this focus: a keyboard's, say, and not a click's. Absent: shown.
   * `Recognizer.focus`'s `visible` counts only these.
   */
  // #273.
  readonly visible?: boolean
}

/** An event, with the target it's for: what a feed over many targets tells, `pointerAmong`'s and `focusAmong`'s. */
// #665's PR 5 (Q56): a Batch's members' gestures, from one source.
export interface TargetEvent<A> {
  /** The target it's for, as the feed's `memberOf` named it. */
  readonly target: unknown
  readonly event: A
}

/**
 * Input from the Environment, as Input feeds: each target's pointer, keys and focus, shared by every
 * subscriber to that target, and heard inside the platform's dispatch. A consumer that wants a Stream
 * reads one through `InputFeed.toStream`.
 */
// #318: each feed a **Shared source** per target.
export class InputSource extends Context.Service<InputSource, {
  /**
   * The pointer events over `target`, and every held pointer's: once a pointer goes down on `target`,
   * its moves, its release and its cancel keep reaching this feed wherever they land, until its
   * release, its cancel, or a move with no button pressed. A down reaches the targets it landed in
   * innermost first, so a press inside marks it before its ancestors' presses read it. `heldPointer` builds
   * it for an Environment.
   */
  // ADR-0019 (a **Held pointer**); #439 (the runtime's **Press claims**).
  readonly pointer: (target: unknown) => InputFeed.InputFeed<PointerLikeEvent>
  /**
   * The keys at `target` or inside it, heard after the app's own handlers, so a consumer reads whether
   * one took the key and can still take it itself. A key reaches the targets it passed through innermost
   * first, as a pointer's down does.
   */
  // ADR-0037; #439.
  readonly keyboard: (target: unknown) => InputFeed.InputFeed<KeyboardLikeEvent>
  // No wheel until a recognizer needs one, which then defines it and its units (ADR-0036,
  // *Amendment (#189)*).
  /** `target` taking and losing focus, and whatever inside it does. */
  readonly focus: (target: unknown) => InputFeed.InputFeed<FocusLikeEvent>
  /**
   * Whether focus is now on `target` or inside it, from an Environment that can say. A keyboard press
   * then holds its target's keys only while it is, as Motion's listens for keys once its element has
   * focus, so an element at rest holds none. Absent: a keyboard press holds the keys throughout, for an
   * Environment whose keys can reach a target without its focus.
   */
  // #460: a **Keyboard press**.
  readonly focusWithin?: ((target: unknown) => boolean) | undefined
  /**
   * `pointer(target)` with the downs `adoptPointer` hands `target` too: for a target that can be handed
   * one, a drag given drag controls. The plain `pointer` then subscribes to no handing, so an element
   * that's only hovered or pressed pays for none. Absent: `pointer` delivers the handed downs itself.
   */
  // #431, #507: **Drag controls**.
  readonly adoptablePointer?: ((target: unknown) => InputFeed.InputFeed<PointerLikeEvent>) | undefined
  /**
   * Hands `raw`, the platform's event of a pointer pressed elsewhere, to `target`, as drag controls
   * start a drag from a handle: delivered on `adoptablePointer(target)` (`pointer(target)` without one)
   * as an `adopted` down at its point, inside this call, and held from there as a down on the target
   * is. The down as delivered, or none, delivering nothing, when `raw` isn't a pressed pointer's event.
   */
  // #431: **Drag controls**. An `Option` (#618, A1): a down that may not be there, outside the per-frame path.
  readonly adoptPointer: (target: unknown, raw: unknown) => Option.Option<PointerLikeEvent>
  /**
   * The pointer events over many targets, from one source, each told with the target it's for:
   * `memberOf(node)` names the target a node the pointer hit is, `undefined` for none, and each target
   * hears what `pointer(target)` would, its enter and leave, the downs and releases over it, and a held
   * pointer's events wherever they land. For many like targets, a Batch's members, where a feed each
   * would cost a listener set each. Absent: `Recognizer.watchHoverAmong` and `watchPressAmong` fail,
   * naming it.
   */
  // #665's PR 5 (Q56, Q17's probe: a listener set per member cost 12 ms and 4.6 KB a member per 1,000).
  readonly pointerAmong?: ((memberOf: (node: unknown) => unknown) => InputFeed.InputFeed<TargetEvent<PointerLikeEvent>>) | undefined
  /**
   * The focus and blur of many targets and of whatever inside each, from one source, each told with the
   * target it's for, as its `memberOf` names it: what `focus(target)` would tell it. Absent: no
   * key presses a target among them.
   */
  // #665's PR 5 (Q57): a **Keyboard press** on a Batch's member.
  readonly focusAmong?: ((memberOf: (node: unknown) => unknown) => InputFeed.InputFeed<TargetEvent<FocusLikeEvent>>) | undefined
}>()("@wardic/core/InputSource") {}

/**
 * `target`'s pointer feed with the downs `adoptPointer` hands it: `input`'s `adoptablePointer`, or its
 * `pointer` when it has none, which then delivers them itself.
 */
// #431, #507.
export const adoptablePointerOf = (input: InputSource["Service"], target: unknown): InputFeed.InputFeed<PointerLikeEvent> =>
  UndefinedOr.match(input.adoptablePointer, { onUndefined: () => input.pointer(target), onDefined: (feed) => feed(target) })

/**
 * A source of an Environment's pointer events, for `heldPointer`: called with `emit`, it calls it with
 * each event and returns the function that stops it. `raw` is the platform's event the
 * `PointerLikeEvent` was mapped from, the same object for the same event on every feed: it's how an
 * event that reaches two feeds is delivered once.
 */
// Tier 2 (ADR-0008), for Environment authors.
export type PointerFeed = (emit: (event: PointerLikeEvent, raw: unknown) => void) => () => void

/**
 * A source of scroll positions, for `heldPointer`: called with `emit`, it reports where every scroller
 * it tracks is at once (the Environment's own, the target's scrolling ancestors), then each new position as it
 * scrolls, and returns the function that stops it. `source` is the same object for the same scroller.
 */
// Tier 2 (ADR-0008), for Environment authors.
export type ScrollFeed = (emit: (source: unknown, position: Point.Point, timeStamp: number) => void) => () => void

/** The feeds `heldPointer` merges into a target's pointer feed. */
// Tier 2 (ADR-0008).
export interface HeldPointerOptions {
  /** The pointer events on the target itself. */
  readonly target: PointerFeed
  /**
   * The downs handed to the target from elsewhere, by `InputSource`'s `adoptPointer`: each held as a
   * down on the target is, and delivered `adopted`. Its other events are left out.
   */
  // #431.
  readonly adopted?: PointerFeed | undefined
  /** Pointer events anywhere in the Environment, subscribed only while a pointer is held. */
  readonly global?: PointerFeed | undefined
  /** Scroll positions, subscribed only while a pointer is held: a scroll moves a held pointer. */
  readonly scroll?: ScrollFeed | undefined
}

/**
 * A held pointer: its last move as forwarded (its down, until it moves), the scroll since its
 * down (added to its events), and whether it has moved since its down (until then a scroll
 * emits nothing).
 */
interface Held {
  last: PointerLikeEvent
  dx: number
  dy: number
  moved: boolean
}

/** `event` moved by `held`'s scroll shift, which it carries as its `scroll`: the same object when there is none. */
const shifted = (held: Held, event: PointerLikeEvent): PointerLikeEvent =>
  Bool.match(Bool.and(held.dx === 0, held.dy === 0), {
    onTrue: () => event,
    onFalse: () => ({ ...event, x: event.x + held.dx, y: event.y + held.dy, scroll: { x: held.dx, y: held.dy } }),
  })

/** An event of one type. */
const ofType =
  (type: PointerLikeEvent["type"]): Predicate.Predicate<PointerLikeEvent> =>
  (event) =>
    event.type === type

/** A move with no button pressed: the release was lost (ADR-0019). */
const isUnpressedMove: Predicate.Predicate<PointerLikeEvent> = Predicate.and(ofType("move"), (event) => Bool.not(event.pressed))

/** Whether `event` ends its pointer's hold: its release, its cancel, or a move with no button pressed. */
const endsHold: Predicate.Predicate<PointerLikeEvent> = Predicate.some([ofType("up"), ofType("cancel"), isUnpressedMove])

/**
 * Whether a `down` anywhere in the Environment means `held`'s release was lost: the same pointer went down
 * again, or a new primary pointer of its type did (only one is primary per type).
 */
const supersedes = (down: PointerLikeEvent, held: PointerLikeEvent): boolean =>
  Bool.or(
    down.pointerId === held.pointerId,
    Bool.every([down.primary, held.primary, down.kind === held.kind]),
  )

/** A feed's stop function, while the feed is subscribed. */
type Stop = MutableRef.MutableRef<Option.Option<() => void>>

/** Stop a feed, once: take its stop function out of `stop`, then call it. */
const stopFeed = (stop: Stop): void =>
  Option.match(MutableRef.getAndSet(stop, Option.none()), { onNone: constVoid, onSome: (stopIt) => stopIt() })

/**
 * A target's pointer feed, for an Environment's `InputSource`: once a pointer goes down on the target,
 * its moves, its release and its cancel keep reaching the feed wherever they land, until it's released.
 * The Environment hands it its own feeds (`HeldPointerOptions`), and each event reaches the consumer
 * inside the platform's dispatch.
 * - **`target`**: the pointer's events on the target, for the feed's whole life.
 * - **`global`**: pointer events anywhere in the Environment, subscribed only while a pointer that went down on the target
 *   is held, from inside that down, so no event after it is missed. A platform that keeps a held pointer
 *   on its target already, as native touch does, leaves it out.
 * - **`adopted`**: the downs handed to the target from elsewhere, held as a down on it is.
 * - **`scroll`**: a scroll moves a held pointer, as Motion's pan counts it, since what's under it moved.
 *   Each scroll moves every held pointer that has moved since its down, and its later events arrive
 *   shifted by the scroll since then. Before its first move a scroll only adds to the shift, so a press
 *   held still while what's under it scrolls stays a press.
 *
 * A hold ends at its pointer's release, its cancel, or a move with no button pressed: a lost release.
 * A new down by the held pointer, or by a new pointer of its kind, means its release was lost too: the
 * hold ends with a move at its last point, with no button pressed, before the down reaches any target.
 *
 * @example
 * const pointer = InputSource.heldPointer({ target: onTarget, global: onPage, scroll: onScroll })
 */
// The **Held pointer** contract of `InputSource.pointer(target)` (ADR-0019; ADR-0028, decision 11).
// `global` is subscribed synchronously inside the target's `down` emit: a subscription made after a
// scheduler hop loses the first 8–32 ms of input in a browser. While a pointer is held, a target event
// that is the same platform event (`raw`) as the last global one is dropped: the DOM delivers a window
// capture-phase listener first, then the target. A lost release: a move with `buttons === 0` (ADR-0019,
// decision 4), or a global down by the held pointer, or by a new primary pointer of its type (a new
// finger: the old one has lifted), ended with an unpressed move at its last position (decision 7); the
// down itself is left to the target it lands on. `global` is unsubscribed synchronously when no pointer
// is held, and when the feed stops.
//
// A scroll (ADR-0019, *Amendment (Reorder)*), as Motion's pan session (PanSession.ts:176-263 @ 16c6122):
// with a `scroll` feed, subscribed beside `global` only while a pointer is held, each change of a
// scrolled source emits a `move` of every held pointer that has moved since its down, at its last point
// shifted by the change. Before its first move a scroll only adds to the shift, as Motion updates
// nothing until the first pointermove (PanSession.ts:271-272). The feed's first report of a source is
// its baseline, not a scroll.
//
// One ordered emit (#318): every platform feed pushes into the same outbox, in the order the platform
// calls them, and each callback ends with a flush (ADR-0032), after the hold's state is updated. The
// per-event path is the hot path and stays quiet; a consumer carries the subscribe span and log. Tier 2
// (ADR-0008), for Environment authors, like `Clock.fromRefreshFrames`. Nothing here names a DOM type.
export const heldPointer = (options: HeldPointerOptions): InputFeed.InputFeed<PointerLikeEvent> => (emit) => {
  // Each held pointer: where a lost release leaves it, and the scroll since its down.
  const held = new Map<number, Held>()
  const stopGlobal: Stop = MutableRef.make(Option.none())
  const stopScroll: Stop = MutableRef.make(Option.none())
  // The platform event the global feed forwarded last, so the target's copy of it is dropped.
  const lastGlobalRaw = MutableRef.make(Option.none<unknown>())
  // Each scrolled source's last position, for the hold.
  const scrollPositions = new Map<unknown, { x: number; y: number }>()

  // What a callback emits, held until its hold's state is updated (`internal/outbox.ts`).
  const outbox = Outbox.make(emit)

  /**
   * A feed's callback, then a flush: the consumer hears what the callback pushed inside the
   * platform's dispatch, with no scheduler hop (ADR-0032). One flush per callback, after
   * the hold's state is updated, so a consumer never sees it half-updated. One that makes
   * the platform dispatch again from its handling leaves those events waiting, in order,
   * for this flush to go on with.
   */
  const flushed =
    <Args extends ReadonlyArray<unknown>>(feed: (...args: Args) => void) =>
    (...args: Args): void => {
      feed(...args)
      outbox.flush()
    }

  const stopFeeds = (): void => {
    stopFeed(stopGlobal)
    stopFeed(stopScroll)
    scrollPositions.clear()
  }

  const unhold = (pointerId: number): void => {
    held.delete(pointerId)
    if (held.size === 0) stopFeeds()
  }

  /** A held pointer's event, from either feed: forwarded with its scroll shift, and the hold kept or ended. */
  const forward = (h: Held, event: PointerLikeEvent): void => {
    const out = shifted(h, event)
    outbox.push(out)
    Bool.match(endsHold(event), {
      onTrue: () => unhold(event.pointerId),
      onFalse: () => {
        // An enter or a leave doesn't move the pointer: a scroll's move carries the last
        // move's event, as Motion's `lastMoveEvent` (#273).
        if (event.type !== "move") return
        h.last = out
        h.moved = true
      },
    })
  }

  const fromScroll = (source: unknown, position: Point.Point, timeStamp: number): void =>
    Option.match(Option.fromUndefinedOr(scrollPositions.get(source)), {
      onNone: () => {
        scrollPositions.set(source, { x: position.x, y: position.y })
      },
      onSome: (last) => {
        const dx = position.x - last.x
        const dy = position.y - last.y
        if (Bool.and(dx === 0, dy === 0)) return
        last.x = position.x
        last.y = position.y
        Iter.forEach(held.values(), (h) => {
          h.dx += dx
          h.dy += dy
          // Until it has moved since its down, a scroll emits nothing for it.
          if (h.moved) {
            const moved: PointerLikeEvent = { ...h.last, type: "move", x: h.last.x + dx, y: h.last.y + dy, scroll: { x: h.dx, y: h.dy }, button: "none", timeStamp }
            h.last = moved
            outbox.push(moved)
          }
        })
      },
    })

  const fromGlobal = (event: PointerLikeEvent, raw: unknown): void =>
    Match.value(event).pipe(
      Match.when({ type: "down" }, (down) =>
        Iter.forEach(Arr.fromIterable(held), ([pointerId, h]) => {
          if (supersedes(down, h.last)) {
            // Its release, wherever it was, isn't known to have landed on the target: no tap.
            outbox.push({ ...h.last, type: "move", pressed: false, button: "none", onTarget: false, timeStamp: down.timeStamp })
            unhold(pointerId)
          }
        }),
      ),
      Match.when({ type: Match.is("move", "up", "cancel") }, (e) =>
        Option.match(Option.fromUndefinedOr(held.get(e.pointerId)), {
          onNone: constVoid,
          onSome: (h) => {
            MutableRef.set(lastGlobalRaw, Option.fromUndefinedOr(raw))
            forward(h, e)
          },
        }),
      ),
      Match.orElse(constVoid),
    )

  /** Subscribe the global and scroll feeds, at the first hold. */
  const startFeeds = (): void => {
    Option.fromUndefinedOr(options.global).pipe(
      Option.filter(() => Option.isNone(MutableRef.get(stopGlobal))),
      Option.match({
        onNone: constVoid,
        onSome: (global) => {
          const stop = global(flushed(fromGlobal))
          // The feed may have ended the hold while subscribing.
          Bool.match(held.size === 0, { onTrue: stop, onFalse: () => MutableRef.set(stopGlobal, Option.some(stop)) })
        },
      }),
    )
    Option.fromUndefinedOr(options.scroll).pipe(
      Option.filter(() => Bool.and(Option.isNone(MutableRef.get(stopScroll)), held.size > 0)),
      Option.match({
        onNone: constVoid,
        onSome: (scroll) => MutableRef.set(stopScroll, Option.some(scroll(flushed(fromScroll)))),
      }),
    )
  }

  /**
   * A down on the target holds its pointer; a second down for a held pointer (its release was lost,
   * or the same press adopted too, #431) keeps the one hold, from this down. `delivered` is the down
   * as the feed tells it: an adopted one's is marked, and its later events aren't.
   */
  const hold = (down: PointerLikeEvent, delivered: PointerLikeEvent = down): void => {
    const first = held.size === 0
    Option.match(Option.fromUndefinedOr(held.get(down.pointerId)), {
      onNone: () => {
        held.set(down.pointerId, { last: down, dx: 0, dy: 0, moved: false })
      },
      onSome: (h) => {
        h.last = down
        h.dx = 0
        h.dy = 0
        h.moved = false
      },
    })
    if (first) startFeeds()
    outbox.push(delivered)
  }

  /** A down handed to the target from elsewhere (#431): held as the target's own are, delivered `adopted`. */
  const fromAdopted = (event: PointerLikeEvent): void => {
    if (event.type !== "down") return
    hold(event, { ...event, adopted: true })
  }

  const fromTarget = (event: PointerLikeEvent, raw: unknown): void => {
    // The same platform event, already forwarded from the global feed.
    if (Option.exists(MutableRef.get(lastGlobalRaw), (last) => last === raw)) {
      MutableRef.set(lastGlobalRaw, Option.none())
      return
    }
    Match.value(event).pipe(
      Match.when({ type: "down" }, hold),
      Match.orElse((e) =>
        Option.match(Option.fromUndefinedOr(held.get(e.pointerId)), {
          onNone: () => {
            outbox.push(e)
          },
          onSome: (h) => forward(h, e),
        }),
      ),
    )
  }

  const stopTarget = options.target(flushed(fromTarget))
  const stopAdopted = UndefinedOr.match(options.adopted, { onUndefined: () => constVoid, onDefined: (adopted) => adopted(flushed(fromAdopted)) })
  return (): void => {
    stopTarget()
    stopAdopted()
    stopFeeds()
  }
}
