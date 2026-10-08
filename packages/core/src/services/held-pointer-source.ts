/**
 * `heldPointerSource` — the Environment-agnostic realization of the **Held pointer**
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
 * authors, like `makeRefreshFrameClock`. Nothing here names a DOM type.
 *
 * Observability: the per-event path is the hot path and stays quiet; the Environment's
 * Shared source wrapper carries the subscribe span and log.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Point } from "../math/index.ts"
import type { PointerLikeEvent } from "./InputSource.ts"

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
export type ScrollFeed = (emit: (source: unknown, position: Point, timeStamp: number) => void) => () => void

/** The feeds {@link heldPointerSource} merges. Tier 2 (ADR-0008). */
export interface HeldPointerSourceOptions {
  /** The pointer events on the target itself. */
  readonly target: PointerFeed
  /** Page-wide pointer events, subscribed only while a pointer is held. */
  readonly global?: PointerFeed | undefined
  /** Scroll positions, subscribed only while a pointer is held: a scroll moves a held pointer. */
  readonly scroll?: ScrollFeed | undefined
}

/**
 * A held pointer: its last event as forwarded, the scroll since its down (added to its
 * events), and whether it has moved since its down (until then a scroll emits nothing).
 */
interface Held {
  last: PointerLikeEvent
  dx: number
  dy: number
  moved: boolean
}

/** `event` moved by `held`'s scroll shift: the same object when there is none. */
const shifted = (held: Held, event: PointerLikeEvent): PointerLikeEvent =>
  Bool.match(Bool.and(held.dx === 0, held.dy === 0), {
    onTrue: () => event,
    onFalse: () => ({ ...event, x: event.x + held.dx, y: event.y + held.dy }),
  })

/** An event of one type. */
const ofType =
  (type: PointerLikeEvent["type"]): Predicate.Predicate<PointerLikeEvent> =>
  (event) =>
    event.type === type

/** A move with no button pressed: the release was lost (ADR-0019). */
const isUnpressedMove: Predicate.Predicate<PointerLikeEvent> = Predicate.and(ofType("move"), (event) => event.buttons === 0)

/** Whether `event` ends its pointer's hold: its release, its cancel, or a move with no button pressed. */
const endsHold: Predicate.Predicate<PointerLikeEvent> = Predicate.some([ofType("up"), ofType("cancel"), isUnpressedMove])

/**
 * Whether a page-wide `down` means `held`'s release was lost: the same pointer went down
 * again, or a new primary pointer of its type did (only one is primary per type).
 */
const supersedes = (down: PointerLikeEvent, held: PointerLikeEvent): boolean =>
  Bool.or(
    down.pointerId === held.pointerId,
    Bool.every([down.isPrimary, held.isPrimary, down.pointerType === held.pointerType]),
  )

/** A feed's stop function, while the feed is subscribed. */
type Stop = MutableRef.MutableRef<Option.Option<() => void>>

/** Stop a feed, once: take its stop function out of `stop`, then call it. */
const stopFeed = (stop: Stop): void =>
  Option.match(MutableRef.getAndSet(stop, Option.none()), { onNone: constVoid, onSome: (stopIt) => stopIt() })

/**
 * The target's `pointer` stream, with every Held pointer's events wherever they land
 * (see the module doc). One ordered emit: every feed offers into the same queue, in the
 * order the platform calls them.
 */
export const heldPointerSource = (options: HeldPointerSourceOptions): Stream.Stream<PointerLikeEvent> =>
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
              h.last = out
              if (event.type === "move") h.moved = true
            },
          })
        }

        const fromScroll = (source: unknown, position: Point, timeStamp: number): void =>
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
                  const moved: PointerLikeEvent = { ...h.last, type: "move", x: h.last.x + dx, y: h.last.y + dy, button: -1, timeStamp }
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
                  Queue.offerUnsafe(queue, { ...h.last, type: "move", buttons: 0, button: -1, timeStamp: down.timeStamp })
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
                const stop = global(fromGlobal)
                // The feed may have ended the hold while subscribing.
                Bool.match(held.size === 0, { onTrue: stop, onFalse: () => MutableRef.set(stopGlobal, Option.some(stop)) })
              },
            }),
          )
          Option.fromUndefinedOr(options.scroll).pipe(
            Option.filter(() => Bool.and(Option.isNone(MutableRef.get(stopScroll)), held.size > 0)),
            Option.match({
              onNone: constVoid,
              onSome: (scroll) => MutableRef.set(stopScroll, Option.some(scroll(fromScroll))),
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

        const stopTarget = options.target(fromTarget)
        return (): void => {
          stopTarget()
          stopFeeds()
        }
      }),
      (stop) => Effect.sync(stop),
    ),
  )
