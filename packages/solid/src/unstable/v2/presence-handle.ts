/**
 * A presence handle on Solid 2 (#257, ADR-0046): an `<AnimatePresence>`'s exits, heard where Solid 1
 * has Motion's `onExitComplete`. A ward can't hand them over: it's disposed the moment its exit
 * starts. The presence outlives its child, so the handle is the presence's.
 *
 * ```tsx
 * const presence = createPresence()
 * <AnimatePresence ref={presence}>…</AnimatePresence>
 * <button disabled={presence.exiting()} onClick={async () => {
 *   setOpen(false)
 *   await presence.next("exitComplete")
 *   await api.save()
 * }}>Close and save</button>
 * ```
 *
 * - `exiting()`: whether a child is exiting, a plain reactive boolean.
 * - `next("exitStart")`: a child left and its exit started. `next("exitComplete")`: every exiting
 *   child has animated out and been removed. An exit a re-entry interrupts doesn't complete: a
 *   waiting `next("exitComplete")` waits on for one that does. Both resolve with `undefined`.
 * - `each(name)`: every one, for `for await` (`waiters.ts`).
 * - `when(name)`: every one, as a memo for an effect (#355).
 * - `createPresence()`'s owner disposed: waiting calls reject with an `AbortError`, and an `each` ends.
 *
 * `ref` also takes a plain callback, `ref={(p) => (presence = p)}`: it's handed the presence's own
 * handle. A `createPresence()` handle given to `ref` is called with that same handle, and hears it.
 *
 * @module
 */
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import { isServer } from "@solidjs/web"
import { type Accessor, createSignal, onCleanup } from "solid-js"
import type { PresenceEvents as ControllerEvents } from "../../presence-controller.ts"
import { eachOf, serverWhen, Waiters, whenOf } from "./waiters.ts"

/** What a presence handle's `next(name)` waits for. */
export interface PresenceEvents {
  /** A child left, and its exit started. */
  readonly exitStart: undefined
  /**
   * Every exiting child has animated out and been removed (Motion's `onExitComplete`): not when the
   * last one ended because a child came back mid-exit, nor when the presence itself went.
   */
  readonly exitComplete: undefined
}

/** A presence handle's event names. */
export type PresenceEvent = keyof PresenceEvents

/** An `<AnimatePresence>`'s exits, heard: see the module. */
export interface Presence {
  /** Given to `<AnimatePresence ref>`: called with that presence's own handle, whose exits it hears from then on. */
  (source: Presence): void
  /** Whether a child is exiting: `true` from an exit's start until no exiting child is left. */
  readonly exiting: Accessor<boolean>
  /** A promise of the next `name` after the call. */
  readonly next: <E extends PresenceEvent>(name: E) => Promise<PresenceEvents[E]>
  /** Every `name` from the call on, for `for await`; it ends when the handle's owner is disposed. */
  readonly each: <E extends PresenceEvent>(name: E) => AsyncIterable<PresenceEvents[E]>
  /**
   * Every `name`, as a memo for an effect: pending until the first, so the effect runs at each
   * one, on any page. `createEffect(presence.when("exitComplete"), () => trigger.focus())`.
   */
  readonly when: <E extends PresenceEvent>(name: E) => Accessor<PresenceEvents[E]>
}

/** A handle's own hearing: what another handle given its source calls. Internal. */
const HEAR = Symbol("wardic.presence.hear")

interface Hearing {
  readonly [HEAR]: (events: ControllerEvents) => void
}

/** The `AbortError`'s message for a `next` the handle's owner cut off. */
const GONE = "The presence handle was disposed before its next event."

/**
 * A handle, under the current owner, and the events that drive it: what an `<AnimatePresence>`
 * tells its controller's exits to, and what a handle given it hears through.
 */
export const makePresenceHandle = (): { readonly handle: Presence; readonly events: ControllerEvents } => {
  const [exiting, setExiting] = createSignal(false)
  // The last value written: Solid 2 reads a write from its next flush, so the signal can't say.
  let written = false
  const waiters = new Waiters<PresenceEvents>(GONE)
  // The handles hearing this one (`createPresence()`'s, given to the presence's `ref`).
  const hearers = new Set<ControllerEvents>()
  const events: ControllerEvents = {
    exitStart: () => {
      waiters.tell("exitStart", constUndefined)
      hearers.forEach((hearer) => hearer.exitStart())
    },
    exiting: (on) => {
      // Only a change is written: a hearer joining syncs to where this one is, in the presence's
      // body, where nothing exits yet, and a write there is one Solid refuses.
      if (written !== on) {
        written = on
        setExiting(on)
      }
      hearers.forEach((hearer) => hearer.exiting(on))
    },
    exitComplete: () => {
      waiters.tell("exitComplete", constUndefined)
      hearers.forEach((hearer) => hearer.exitComplete())
    },
  }
  const handle = ((source: Presence): void => {
    ;(source as unknown as Hearing)[HEAR](events)
  }) as Presence
  Object.defineProperties(handle, {
    exiting: { value: exiting },
    next: { value: <E extends PresenceEvent>(name: E) => waiters.wait(name) },
    each: { value: <E extends PresenceEvent>(name: E) => eachOf<PresenceEvents, E>(waiters, name) },
    when: { value: <E extends PresenceEvent>(name: E) => whenOf<PresenceEvents, E>(waiters, name) },
    [HEAR]: {
      value: (hearer: ControllerEvents): void => {
        hearers.add(hearer)
        // It starts from where this presence is now.
        hearer.exiting(written)
      },
    },
  })
  // Its waits end with its owner. Its hearers stay: a presence's teardown, after, still tells them
  // its exits are off.
  onCleanup(() => waiters.dispose())
  return { handle, events }
}

/**
 * Hears an `<AnimatePresence>`'s exits, given to its `ref`: `exiting()` is whether a child is
 * leaving, and `next("exitComplete")` resolves once every leaving child has gone. Solid 2's form of
 * Motion's `onExitComplete`.
 *
 * @example
 * const presence = createPresence()
 * <AnimatePresence ref={presence}>…</AnimatePresence>
 * await presence.next("exitComplete")
 * @see https://wardic.dev/reference/solid/presence/create-presence
 */
// On a server nothing exits: exiting() is false, next never settles, and each ends at once.
export const createPresence = (): Presence => {
  if (isServer) return SERVER_PRESENCE
  return makePresenceHandle().handle
}

/** A server's handle: nothing exits there. */
const SERVER_PRESENCE: Presence = Object.defineProperties((() => {}) as unknown as Presence, {
  exiting: { value: () => false },
  next: { value: (): Promise<never> => new Promise<never>(constUndefined) },
  each: { value: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ value: undefined, done: true as const }) }) }) },
  when: { value: serverWhen },
  [HEAR]: { value: () => {} },
})

/** A server's `<AnimatePresence ref>`: handed the server's handle. Internal. */
export const serverPresenceHandle = (): Presence => SERVER_PRESENCE

/** Whether `ref` was given. Internal. */
export const hasRef = (ref: ((presence: Presence) => void) | undefined): ref is (presence: Presence) => void => Predicate.isFunction(ref)
