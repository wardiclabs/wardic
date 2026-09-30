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
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect. It is for Environment
 * authors, like `makeRefreshFrameClock`. Nothing here names a DOM type.
 *
 * Observability: the per-event path is the hot path and stays quiet; the Environment's
 * Shared source wrapper carries the subscribe span and log.
 */
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { PointerLikeEvent } from "./InputSource.ts"

/**
 * A source of pointer events: called with `emit`, it starts calling it for each event
 * and returns the function that stops it. Tier 2 (ADR-0008), for Environment authors. `raw` is the platform event the
 * {@link PointerLikeEvent} was mapped from (any object that is the same for the same
 * event on both feeds), used only to deliver an event once.
 */
export type PointerFeed = (emit: (event: PointerLikeEvent, raw: unknown) => void) => () => void

/** The two feeds {@link heldPointerSource} merges. Tier 2 (ADR-0008). */
export interface HeldPointerSourceOptions {
  /** The pointer events on the target itself. */
  readonly target: PointerFeed
  /** Page-wide pointer events, subscribed only while a pointer is held. */
  readonly global?: PointerFeed | undefined
}

/** Whether `event` ends its pointer's hold: its release, its cancel, or a move with no button pressed. */
const endsHold = (event: PointerLikeEvent): boolean =>
  event.type === "up" || event.type === "cancel" || (event.type === "move" && event.buttons === 0)

/**
 * Whether a page-wide `down` means `held`'s release was lost: the same pointer went down
 * again, or a new primary pointer of its type did (only one is primary per type).
 */
const supersedes = (down: PointerLikeEvent, held: PointerLikeEvent): boolean =>
  down.pointerId === held.pointerId || (down.isPrimary && held.isPrimary && down.pointerType === held.pointerType)

/**
 * The target's `pointer` stream, with every Held pointer's events wherever they land
 * (see the module doc). One ordered emit: both feeds offer into the same queue, in the
 * order the platform calls them.
 */
export const heldPointerSource = (options: HeldPointerSourceOptions): Stream.Stream<PointerLikeEvent> =>
  Stream.callback<PointerLikeEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        // Each held pointer's last event: where a lost release leaves it.
        const held = new Map<number, PointerLikeEvent>()
        let stopGlobal: (() => void) | undefined
        let lastGlobalRaw: unknown

        const unhold = (pointerId: number): void => {
          held.delete(pointerId)
          if (held.size === 0 && stopGlobal !== undefined) {
            const stop = stopGlobal
            stopGlobal = undefined
            stop()
          }
        }

        const fromGlobal = (event: PointerLikeEvent, raw: unknown): void => {
          if (event.type === "down") {
            for (const [pointerId, last] of held) {
              if (!supersedes(event, last)) continue
              Queue.offerUnsafe(queue, { ...last, type: "move", buttons: 0, button: -1, timeStamp: event.timeStamp })
              unhold(pointerId)
            }
            return
          }
          if (event.type !== "move" && event.type !== "up" && event.type !== "cancel") return
          if (!held.has(event.pointerId)) return
          lastGlobalRaw = raw
          Queue.offerUnsafe(queue, event)
          if (endsHold(event)) unhold(event.pointerId)
          else held.set(event.pointerId, event)
        }

        const fromTarget = (event: PointerLikeEvent, raw: unknown): void => {
          // The same platform event, already forwarded from the page-wide feed.
          if (raw !== undefined && raw === lastGlobalRaw) {
            lastGlobalRaw = undefined
            return
          }
          if (event.type === "down") {
            // A second down for a held pointer (its release was lost) keeps the one hold.
            const first = held.size === 0
            held.set(event.pointerId, event)
            if (first && options.global !== undefined && stopGlobal === undefined) {
              const stop = options.global(fromGlobal)
              // The feed may have ended the hold while subscribing.
              if (held.size === 0) stop()
              else stopGlobal = stop
            }
          } else if (held.has(event.pointerId)) {
            if (endsHold(event)) {
              Queue.offerUnsafe(queue, event)
              unhold(event.pointerId)
              return
            }
            held.set(event.pointerId, event)
          }
          Queue.offerUnsafe(queue, event)
        }

        const stopTarget = options.target(fromTarget)
        return (): void => {
          stopTarget()
          if (stopGlobal !== undefined) {
            const stop = stopGlobal
            stopGlobal = undefined
            stop()
          }
        }
      }),
      (stop) => Effect.sync(stop),
    )
  )
