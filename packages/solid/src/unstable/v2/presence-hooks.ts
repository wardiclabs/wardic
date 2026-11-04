/**
 * Motion's presence hooks on Solid 2 (#277's PR 5b, ADR-0048), in the shape #257 settled on: async
 * values, no callbacks. Each is given to `ref`, which ties it to the child that holds its element.
 *
 * - `usePresence()` holds the leaving child until `safeToRemove()`; `next("leave")` resolves as it
 *   leaves, once its node is back in place, with the presence's `custom`. The child's own code is
 *   disposed by then: what runs after the `await` is plain work that ends by calling `safeToRemove()`.
 * - `useIsPresent()` is a sensor: `true`, `false` from its child's leave on, for what still runs on
 *   the retained node.
 * - `usePresenceData()` is the presence's `custom`.
 *
 * @module
 */
import { isServer } from "@solidjs/web"
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createSignal } from "solid-js"
import { usePresenceContext } from "./presence.tsx"
import { eachOf, Waiters } from "./waiters.ts"

/** What a `usePresence` handle waits for. */
export interface PresenceLeaveEvents {
  /** Its child left: the presence's `custom`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly leave: any
}

/** A `usePresence` handle: see the module. */
export interface PresenceHold {
  /** Given to `ref`: the element whose child it holds. */
  (element: Element): void
  /** Whether its child is present: `false` from its leave on. */
  readonly isPresent: Accessor<boolean>
  /** A promise of its child's leave, with the presence's `custom`: rejected if the child or the presence goes some other way. */
  readonly next: <E extends keyof PresenceLeaveEvents>(name: E) => Promise<PresenceLeaveEvents[E]>
  /** Each leave from the call on, for `for await`. */
  readonly each: <E extends keyof PresenceLeaveEvents>(name: E) => AsyncIterable<PresenceLeaveEvents[E]>
  /** Let its child go: once it's left; before, nothing. */
  readonly safeToRemove: () => void
}

/** `useIsPresent`'s sensor: read for whether its child is present, given to `ref` for its element. */
export interface IsPresent {
  (): boolean
  (element: Element): void
}

/** The `AbortError`'s message for a `next("leave")` its child or presence cut off. */
const GONE = "The child went before it left its presence."

/** Whether a call is Solid applying the handle as a ref. */
const isElement = (value: unknown): value is Element => Predicate.hasProperty(value, "nodeType")

/** A registration with the nearest presence, `isPresent` turning `false` at its child's leave. */
const watchOf = (
  holds: boolean,
  onLeave: (custom: unknown, release: () => void) => void,
  onGone: () => void,
): { readonly present: Accessor<boolean>; readonly attach: (element: Element) => void } => {
  const [present, setPresent] = createSignal(true, { ownedWrite: true })
  let element: Element | undefined
  UndefinedOr.map(usePresenceContext(), (presence) =>
    UndefinedOr.map(presence.watch, (watch) =>
      watch({
        element: () => element,
        holds,
        leave: (custom, release) => {
          setPresent(false)
          onLeave(custom, release)
        },
        gone: onGone,
      })))
  return {
    present,
    attach: (at) => {
      element = at
    },
  }
}

/**
 * Holds a child of `<AnimatePresence>` on the page as it leaves, until you call `safeToRemove()`: for
 * an exit of your own, such as a Web Animation. Give it to `ref` on an element in the child. Its
 * `next("leave")` resolves as the child leaves; `isPresent()` is `false` from then on. Motion's
 * `usePresence`.
 *
 * @example
 * const hold = usePresence()
 * void hold.next("leave").then(() => setTimeout(hold.safeToRemove, 300))
 * <div ref={hold} />
 * @see https://wardic.dev/reference/solid/presence/use-presence
 */
// The child's own code is disposed by the time it leaves: what runs after the await is plain work that
// ends with safeToRemove(). Outside a presence it's always present, and next("leave") never settles.
export const usePresence = (): PresenceHold => {
  if (isServer) return SERVER_HOLD
  const waiters = new Waiters<PresenceLeaveEvents>(GONE)
  let release: () => void = () => {}
  const { present, attach } = watchOf(
    true,
    (custom, done) => {
      release = done
      waiters.tell("leave", () => custom)
    },
    () => waiters.dispose(),
  )
  const hold = ((element: Element): void => {
    attach(element)
  }) as PresenceHold
  Object.defineProperties(hold, {
    isPresent: { value: present },
    next: { value: <E extends keyof PresenceLeaveEvents>(name: E) => waiters.wait(name) },
    each: { value: <E extends keyof PresenceLeaveEvents>(name: E) => eachOf<PresenceLeaveEvents, E>(waiters, name) },
    safeToRemove: { value: () => release() },
  })
  return hold
}

/**
 * Whether a child of `<AnimatePresence>` is still present: `false` from its leave on, while its exit
 * plays. Give it to `ref` on an element in the child, and call it to read. Outside a presence, always
 * `true`. Motion's `useIsPresent`.
 *
 * @example
 * const present = useIsPresent()
 * <button ref={present} disabled={!present()}>Save</button>
 * @see https://wardic.dev/reference/solid/presence/use-is-present
 */
export const useIsPresent = (): IsPresent => {
  if (isServer) return (() => true) as IsPresent
  const { present, attach } = watchOf(false, () => {}, () => {})
  // eslint-disable-next-line solid/reactivity -- the sensor: a ref Solid calls with its element, and an accessor its caller reads where it tracks
  return ((element?: unknown): boolean | undefined => {
    if (isElement(element)) {
      attach(element)
      return undefined
    }
    return present()
  }) as IsPresent
}

/** Motion's `usePresenceData`: the nearest presence's `custom`, `undefined` outside one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const usePresenceData = <T = any,>(): Accessor<T | undefined> => {
  const presence = usePresenceContext()
  return () => UndefinedOr.map(UndefinedOr.map(presence, (p) => p.data), (data) => data()) as T | undefined
}

/** A server's hold: nothing leaves there. */
const SERVER_HOLD: PresenceHold = Object.defineProperties((() => {}) as unknown as PresenceHold, {
  isPresent: { value: () => true },
  next: { value: (): Promise<never> => new Promise<never>(constUndefined) },
  each: { value: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ value: undefined, done: true as const }) }) }) },
  safeToRemove: { value: () => {} },
})
