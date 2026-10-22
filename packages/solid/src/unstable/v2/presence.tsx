/**
 * `<AnimatePresence>` on Solid 2 (#209, ADR-0007): exit-before-unmount for its children (many since
 * #277, ADR-0048), and `mode="wait"`, as the Solid 1 binding's. Its work (each retained node, its parent-driven exit,
 * the twins it hands back) is Solid-free, in `presence-controller.ts`. What's Solid 2's:
 *
 * - **The children are resolved with `children()`** under the presence's context, so each child's
 *   ward registers its exit record with it.
 * - **An effect tells the controller which elements are present,** in its apply: after Solid 2's
 *   flush has applied the change, the leaving nodes removed. The controller puts them back before
 *   the flush ends, so no paint shows them gone.
 * - **Once settled** (`onSettledClientOnly`), the first render has ended, for `initial={false}` (#134).
 *
 * @module
 */
import { isServer, type JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import { children, createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext } from "solid-js"
import { makePresence, type PresenceMode } from "../../presence-controller.ts"
import type { PresenceContextValue } from "../../presence-record.ts"
import { useWardicPositionalKeys, useWardicProjection, useWardicReducedMotion, useWardicRuntime } from "./provider.tsx"
import { CLIENT_ONLY, onSettledClientOnly } from "./solid-reactivity.ts"
import { hasRef, makePresenceHandle, type Presence, serverPresenceHandle } from "./presence-handle.ts"

/**
 * The nearest `<AnimatePresence>`'s registrar, `null` outside one: Solid 2 takes an `undefined`
 * default for none and then throws in `useContext`.
 */
export const PresenceContext = createContext<PresenceContextValue | null>(null)

/** The nearest `<AnimatePresence>`'s registrar, `undefined` outside one. */
export const usePresenceContext = (): PresenceContextValue | undefined => Option.getOrUndefined(Option.fromNullishOr(useContext(PresenceContext)))

/** {@link AnimatePresence}'s props. */
export interface AnimatePresenceProps {
  readonly children?: JSX.Element
  /**
   * `false`: the child present at this presence's first render starts at its `animate`, with no
   * enter animation (it and every Wardic element under it, as Motion's); a child that enters later
   * animates in from its `initial`. Exits are unchanged (#134).
   */
  readonly initial?: boolean
  /**
   * Its exits, heard (#257, ADR-0046): a `createPresence()` handle, or a callback handed the
   * presence's own handle. Optional: left out, no handle is made. Read once.
   */
  readonly ref?: ((presence: Presence) => void) | undefined
  /**
   * How a child enters while another exits (#277, ADR-0048), Motion's `mode`: `"sync"` (the default),
   * at once, beside the leaver; `"popLayout"`, at once, the leaver popped out of the flow where it was
   * (`position: absolute`, its size kept), so the children after it take their places, a `layout`
   * one animating there; `"wait"`, once every leaver has animated out and been removed. A
   * waiting child is built at once, as Solid builds it, so its own code (its effects included) runs
   * then, off the page; its Wardic elements start once it's on the page.
   */
  readonly mode?: PresenceMode | undefined
  /**
   * What a leaving child's dynamic `exit` resolves with (#277, ADR-0048, Motion's `custom`), over the
   * child's own `custom`: a child that has left can't take new props, so the presence hands it the
   * latest. Read as each child leaves.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly custom?: any
}

/**
 * Wraps its children (a conditional one, `<Show>`, or a `<For>`'s) and animates each one's exit
 * before it's removed (#277): each that leaves exits in its place, and one that comes back mid-exit
 * is a new node, entering beside the leaver.
 * The child is a `wardic.*` element or an element with a ward on it, whose config's `exit` is the
 * exit's target. Inside a `<WardicProvider>`.
 */
export function AnimatePresence(props: AnimatePresenceProps): JSX.Element {
  // A server render has no exit to drive: the same boundaries, a context that registers nothing.
  // eslint-disable-next-line solid/components-return-once -- `isServer` is a constant: the component takes one path for its life
  if (isServer) return serverPresence(props)
  // Its own handle, made only when `ref` is given (#257): its exits are told to it, and it's handed to `ref`.
  const ref = untrack(() => props.ref)
  const own = Bool.match(hasRef(ref), { onTrue: makePresenceHandle, onFalse: constUndefined })
  // `mode="wait"`'s held children may go on the page (#277): the children are rendered again.
  const [released, release] = createSignal<undefined>(undefined, { equals: false })
  const presence = makePresence({
    runtime: useWardicRuntime(),
    projection: useWardicProjection(),
    reducedMotion: useWardicReducedMotion(),
    positionalKeys: useWardicPositionalKeys(),
    initial: () => untrack(() => props.initial),
    events: UndefinedOr.map(own, (handle) => handle.events),
    mode: () => props.mode,
    custom: () => untrack(() => props.custom),
    release: () => release(undefined),
  })
  UndefinedOr.map(own, (handle) => (ref as (presence: Presence) => void)(handle.handle))
  onSettledClientOnly(presence.mounted)
  onCleanup(presence.teardown)

  // Resolved under the context, so the child's ward sees it.
  const Tracker = (): JSX.Element => {
    const resolved = children(() => props.children)
    // What goes on the page (#277): every child, but under `mode="wait"` one entering is held off it
    // while a child exits. The controller is told what went on.
    const shown = createMemo(() => {
      released()
      return presence.shown(resolved())
    }, CLIENT_ONLY)
    createEffect(
      shown,
      (current) => {
        presence.present(current)
      },
      CLIENT_ONLY,
    )
    return shown as unknown as JSX.Element
  }

  // Its `custom`, reactive, for `usePresenceData` (#277's PR 5b).
  const context: PresenceContextValue = { ...presence.context, data: () => props.custom }
  return (
    <PresenceContext value={context}>
      <Tracker />
    </PresenceContext>
  )
}

/** {@link AnimatePresence} during a server render: the client's boundaries, nothing to track. */
const serverPresence = (props: AnimatePresenceProps): JSX.Element => {
  // A `ref` is handed the server's handle, on which nothing exits (#257).
  const ref = untrack(() => props.ref)
  if (hasRef(ref)) ref(serverPresenceHandle())
  // A server renders once: every child is set up with the first render (#134).
  const context: PresenceContextValue = { register: () => () => {}, blocksInitial: () => untrack(() => props.initial) === false, data: () => props.custom }
  const Tracker = (): JSX.Element => children(() => props.children) as unknown as JSX.Element
  return (
    <PresenceContext value={context}>
      <Tracker />
    </PresenceContext>
  )
}
