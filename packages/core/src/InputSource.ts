/**
 * The `InputSource` module: input as Environment-agnostic event streams (ADR-0004, ADR-0019),
 * behind the `InputSource.InputSource` service, its event shapes, and `heldPointer`, the Held
 * pointer contract every Environment builds its pointer streams from (ADR-0028, decision 11).
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constFalse, constTrue, constVoid } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type * as Point from "./Point.ts"

/**
 * Environment-agnostic projections of input events. These are deliberately not
 * DOM types — a native or canvas environment produces the same shapes — so the
 * engine's gesture logic stays portable. Environments map their raw events onto
 * these in their `InputSource` Layer.
 */
export interface PointerLikeEvent {
  readonly type: "down" | "move" | "up" | "cancel" | "enter" | "leave"
  readonly pointerId: number
  readonly x: number
  readonly y: number
  /**
   * Whether any button is down during this event. A pressed pointer's moves are pressed, so an
   * unpressed move from a pointer still held on a target means its release was lost (a **Stale
   * gesture**, ADR-0019).
   */
  readonly pressed: boolean
  readonly timeStamp: number
  /** Its **Pointer kind** (#189). */
  readonly kind: PointerKind
  /** The button whose state this event changed, `"none"` when none did, as on a move (#189). */
  readonly button: PointerButton
  /**
   * Whether it's its kind's first contact on the page: the mouse always is; a second finger
   * isn't. Not the **Primary pointer** itself, which `isPrimaryPointer` decides from it (#189).
   */
  readonly primary: boolean
  /**
   * The scroll its pointer's hold has counted into `x`/`y` since its down (ADR-0019,
   * *Amendment (Reorder)*): zero for a pointer that isn't held, or held with nothing scrolled.
   * `x - scroll.x` is where the pointer is on the screen (#257). {@link heldPointer} sets it.
   */
  readonly scroll: Point.Point
  /**
   * Whether it landed on the target or inside it (#257): the target's own events do; a held
   * pointer's page-wide ones say where they landed. A release that does is a tap (Motion's
   * press, `isNodeOrChild`); one that doesn't, a tap's cancel.
   */
  readonly onTarget: boolean
  /**
   * The platform's own event this one was mapped from (#273): opaque to core, which never reads it.
   * A binding hands it to an app's gesture callback (Motion's `(event, info)`). A held pointer's
   * scroll-driven move and a lost release's ending move carry its last move's, or its down's
   * before it has moved (Motion's `lastMoveEvent`): never an enter's or a leave's.
   */
  readonly raw?: unknown
}

/** No scroll counted: shared, so an event not held allocates nothing for it. */
export const NO_SCROLL: Point.Point = { x: 0, y: 0 }

/**
 * A **Pointer kind**, in core's own words (ADR-0036, *Amendment (#189)*): `"other"` for one core
 * has no rule about. Each Environment maps its platform's kinds onto these.
 */
export type PointerKind = "mouse" | "pen" | "touch" | "other"

/**
 * A pointer button, in core's own words (ADR-0036, *Amendment (#189)*): `"none"` when an event
 * changed no button, `"other"` for a button core has no rule about.
 */
export type PointerButton = "main" | "middle" | "secondary" | "other" | "none"

/**
 * Build a {@link PointerLikeEvent} with a mouse's defaults: pointer 1 at `(0, 0)` and
 * time 0, kind `"mouse"`, primary, `button` `"main"` on a down or up and `"none"` otherwise,
 * pressed on a down or move, no scroll counted, and on the target. Any field given wins.
 *
 * Tier 2 (ADR-0008): for test scripts and mouse-only Environments (ADR-0019).
 */
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
 * Whether `event` comes from a **Primary pointer**, the only one `drag` and `press`
 * listen to: a mouse event with its main button or no button change, or any other
 * pointer that is `primary`. A right-click doesn't drag, and a second finger neither
 * presses nor moves a drag. Motion's `isPrimaryPointer`
 * (`motion-dom/src/gestures/utils/is-primary-pointer.ts` @ `16c6122`), over core's own
 * fields (ADR-0036, *Amendment (#189)*).
 *
 * Tier 2 (ADR-0008): for custom recognizers (ADR-0019).
 */
export const isPrimaryPointer = (event: PointerLikeEvent): boolean =>
  Match.value(event).pipe(
    Match.when({ kind: "mouse" }, (mouse) => Bool.or(mouse.button === "main", mouse.button === "none")),
    Match.orElse((other) => other.primary),
  )

/**
 * A key, in core's own names (ADR-0037): the keys core acts on, and `"other"` for the rest. Each
 * Environment maps its platform's key names onto these, so no platform's names reach core.
 */
export type Key = "space" | "enter" | "escape" | "left" | "right" | "up" | "down" | "home" | "end" | "other"

/**
 * A key going down or up at a target, or inside it (ADR-0037). `fromTarget`: the key came from the
 * target itself, not from something inside it (a text field, a button). `handled`: a handler that
 * ran before this one (the app's) already took the key, as the Environment sees it once those have
 * run. `handle()` takes it, so the platform's own response to it (scrolling, say) doesn't run; a
 * consumer calls it while it handles the event, which reaches it inside the platform's dispatch
 * (ADR-0032).
 */
export interface KeyboardLikeEvent {
  readonly type: "down" | "up"
  readonly key: Key
  readonly repeat: boolean
  readonly timeStamp: number
  readonly fromTarget: boolean
  readonly handled: boolean
  readonly handle: () => void
}

export interface FocusLikeEvent {
  readonly type: "focus" | "blur"
  readonly timeStamp: number
  /**
   * Whether the Environment shows this focus (#273): the DOM's `:focus-visible`, a keyboard's focus
   * rather than a pointer's click. Absent: shown. `Recognizer.focus`'s `visible` counts only these.
   */
  readonly visible?: boolean
}

/**
 * Raw event streams from the environment. `target` is environment-defined and
 * opaque to the engine (an element in the DOM, a node in a scene graph, etc.).
 *
 * `pointer(target)` carries the pointer events over `target` and every **Held
 * pointer**'s: once a pointer goes down on `target`, its moves, release and cancel
 * keep reaching this stream wherever they land, until its release, its cancel or a
 * move with no button pressed (ADR-0019). Core's `heldPointer` implements that
 * for an Environment.
 */
export class InputSource extends Context.Service<InputSource, {
  readonly pointer: (target: unknown) => Stream.Stream<PointerLikeEvent>
  /**
   * The keys at `target` or inside it (ADR-0037): a **Shared source** per target, delivered inside
   * the platform's dispatch, after the app's own handlers, so a consumer reads whether one took
   * the key and can still take it itself.
   */
  readonly keyboard: (target: unknown) => Stream.Stream<KeyboardLikeEvent>
  // No wheel until a recognizer needs one, which then defines it and its units (ADR-0036,
  // *Amendment (#189)*).
  /**
   * Focus/blur transitions for a target. Like `pointer`, this is a Shared
   * (environment-agnostic) source: every subscriber sees the same script of
   * transitions, regardless of the underlying DOM/native focus model.
   */
  readonly focus: (target: unknown) => Stream.Stream<FocusLikeEvent>
}>()("@wardic/InputSource") {}

/**
 * `heldPointer` — the Environment-agnostic realization of the **Held pointer**
 * contract of `InputSource.pointer(target)` (ADR-0019): once a pointer goes down on
 * the target, its moves, release and cancel keep reaching the target's stream
 * wherever they land, until it is released.
 *
 * An Environment hands it two {@link PointerFeed}s and gets back the target's stream:
 *
 * - `target`: the pointer events on the target itself, for the stream's whole life.
 * - `global`: page-wide pointer events, subscribed only while a pointer that went down
 *   on the target is held. It is subscribed synchronously inside the target's `down`
 *   emit, so no event after the down can be missed (a subscription made later, after a
 *   scheduler hop, loses the first 8–32 ms of input in a browser). A platform that
 *   already keeps a held pointer on its target (native touch, AppKit drags) leaves it
 *   out, and the target's events pass through.
 *
 * While a pointer is held, the helper forwards its global moves, release and cancel,
 * and drops a target event that is the same platform event (`raw`) as the last global
 * one: the DOM delivers a window capture-phase listener first, then the target. A held
 * pointer ends at its up, its cancel, or a move with `buttons === 0` (a lost release,
 * ADR-0019 decision 4); the ending event is forwarded first. A global `down` by the
 * held pointer, or by a new primary pointer of its type (a new finger: the old one has
 * lifted), means its release was lost where no event reports it: the helper ends the
 * hold with an unpressed move at its last position (decision 7), before the down
 * reaches any target, and the down itself is left to the target it lands on. `global`
 * is unsubscribed synchronously when no pointer is held, and when the stream ends.
 *
 * A scroll moves a held pointer (ADR-0019, *Amendment (Reorder)*): the page under it
 * moved, so it is somewhere else on the page, as Motion's pan session counts it
 * (PanSession.ts:176-263 at 16c6122). With a `scroll` {@link ScrollFeed}, subscribed
 * beside `global` and only while a pointer is held, each change of a scrolled source
 * emits a `move` of every held pointer that has moved since its down, at its last point
 * shifted by the change, and every later event of that pointer arrives shifted by the
 * scroll since its down. Before its first move a scroll only adds to the shift, as
 * Motion updates nothing until the first pointermove (PanSession.ts:271-272), so a press
 * held still while the page scrolls stays a press. The feed's first report of a source
 * is its baseline, not a scroll.
 *
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect. It is for Environment
 * authors, like `Clock.fromRefreshFrames`. Nothing here names a DOM type.
 *
 * Delivery is inline (ADR-0032): each feed's callback ends with `Queue.flushUnsafe`, so the
 * stream's consumer, waiting on the queue, handles the events before the platform's dispatch
 * returns. Without it the queue releases its taker through Effect's scheduler, a
 * `setTimeout(0)` in a browser, after the frame's paint (#32).
 *
 * Observability: the per-event path is the hot path and stays quiet; the Environment's
 * Shared source wrapper carries the subscribe span and log.
 */

/**
 * A source of pointer events: called with `emit`, it starts calling it for each event
 * and returns the function that stops it. Tier 2 (ADR-0008), for Environment authors. `raw` is the platform event the
 * {@link PointerLikeEvent} was mapped from (any object that is the same for the same
 * event on both feeds), used only to deliver an event once.
 */
export type PointerFeed = (emit: (event: PointerLikeEvent, raw: unknown) => void) => () => void

/**
 * A source of scroll positions: called with `emit`, it reports the current position of
 * every scroller it tracks (the page, the target's scrolling ancestors) at once, then
 * each new position as it scrolls, and returns the function that stops it. `source` is
 * any object that is the same for the same scroller. Tier 2 (ADR-0008), for Environment
 * authors.
 */
export type ScrollFeed = (emit: (source: unknown, position: Point.Point, timeStamp: number) => void) => () => void

/** The feeds {@link heldPointer} merges. Tier 2 (ADR-0008). */
export interface HeldPointerOptions {
  /** The pointer events on the target itself. */
  readonly target: PointerFeed
  /** Page-wide pointer events, subscribed only while a pointer is held. */
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
 * Whether a page-wide `down` means `held`'s release was lost: the same pointer went down
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
 * The target's `pointer` stream, with every Held pointer's events wherever they land
 * (see the module doc). One ordered emit: every feed offers into the same queue, in the
 * order the platform calls them, and each feed's callback ends with a flush, so a waiting
 * consumer handles the events inside the platform's dispatch (ADR-0032).
 */
export const heldPointer = (options: HeldPointerOptions): Stream.Stream<PointerLikeEvent> =>
  Stream.callback<PointerLikeEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        // Each held pointer: where a lost release leaves it, and the scroll since its down.
        const held = new Map<number, Held>()
        const stopGlobal: Stop = MutableRef.make(Option.none())
        const stopScroll: Stop = MutableRef.make(Option.none())
        // The platform event the page-wide feed forwarded last, so the target's copy of it is dropped.
        const lastGlobalRaw = MutableRef.make(Option.none<unknown>())
        // Each scrolled source's last position, for the hold.
        const scrollPositions = new Map<unknown, { x: number; y: number }>()

        /**
         * A feed's callback, then a flush: the stream's consumer, waiting on the queue, takes
         * what the callback offered inside the platform's dispatch, with no scheduler hop
         * (ADR-0032). One flush per callback, after the hold's state is updated, so a
         * consumer never sees it half-updated. A consumer that is busy (an emit from inside
         * its own handling) isn't waiting: the events stay queued, in order, for its next take.
         */
        const flushed =
          <Args extends ReadonlyArray<unknown>>(feed: (...args: Args) => void) =>
          (...args: Args): void => {
            feed(...args)
            Queue.flushUnsafe(queue)
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
          Queue.offerUnsafe(queue, out)
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
                  Queue.offerUnsafe(queue, moved)
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
                  Queue.offerUnsafe(queue, { ...h.last, type: "move", pressed: false, button: "none", onTarget: false, timeStamp: down.timeStamp })
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

        /** Subscribe the page-wide and scroll feeds, at the first hold. */
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

        /** A down on the target holds its pointer; a second down for a held pointer (its release was lost) keeps the one hold, from this down. */
        const hold = (down: PointerLikeEvent): void => {
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
          Queue.offerUnsafe(queue, down)
        }

        const fromTarget = (event: PointerLikeEvent, raw: unknown): void => {
          // The same platform event, already forwarded from the page-wide feed.
          if (Option.exists(MutableRef.get(lastGlobalRaw), (last) => last === raw)) {
            MutableRef.set(lastGlobalRaw, Option.none())
            return
          }
          Match.value(event).pipe(
            Match.when({ type: "down" }, hold),
            Match.orElse((e) =>
              Option.match(Option.fromUndefinedOr(held.get(e.pointerId)), {
                onNone: () => {
                  Queue.offerUnsafe(queue, e)
                },
                onSome: (h) => forward(h, e),
              }),
            ),
          )
        }

        const stopTarget = options.target(flushed(fromTarget))
        return (): void => {
          stopTarget()
          stopFeeds()
        }
      }),
      (stop) => Effect.sync(stop),
    ),
  )
