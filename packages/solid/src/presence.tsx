/**
 * `<AnimatePresence>` — exit-before-unmount for its children (ADR-0007; many since #277, ADR-0048).
 *
 * Doctrine: the LEAVING child cannot animate its own exit — Solid disposes its
 * reactive owner (and would remove its DOM node) the instant the `<Show>` (or
 * other control flow) that renders it flips false. So exit is PARENT-DRIVEN:
 *
 *   1. While a child is alive, its `createWard` spine REGISTERS a record with the
 *      nearest `<AnimatePresence>` via {@link PresenceContext}. The record holds
 *      two LIVE mutable refs: `snapshot.current` (the latest emitted value-map,
 *      updated each frame by the spine) and `exit.current` (the exit target,
 *      kept current by a `createEffect` reading `cfg().exit`). The child does NOT
 *      unregister on its own `onCleanup` — `<AnimatePresence>` owns removal.
 *   2. `<AnimatePresence>` resolves its children via Solid `children()` (one, or a
 *      `<For>`'s many) and tracks the present elements. When one leaves the resolved
 *      children AND a registration exists for it, it RE-INSERTS / KEEPS that DOM
 *      node where it was instead of letting it vanish, then runs the exit animation
 *      itself (from `snapshot.current` toward `exit.current` via the provider
 *      runtime + the Renderer's `project`/`commit`), and on the exit's settle
 *      removes the node from the DOM and the registration.
 *   3. If `exit.current` is empty/undefined the node is removed immediately.
 *
 * Node retention (the hard part): mirrors solid-transition-group's single-child
 * approach. We resolve `children()` (which returns the live DOM node) and, when
 * the reactive branch drops it, RE-APPEND the captured node to our container so
 * the disposed owner's removal is undone — the node survives long enough for the
 * parent-driven exit, then we remove it on settle. The registration's snapshot /
 * exit refs are plain objects that outlive the child's owner, so the exit has
 * everything it needs after the child is gone.
 *
 * A child is its DOM node (#277): each that leaves exits on its own, in its place. A
 * child that comes back mid-exit is a new node, which enters beside the leaver while
 * the leaver finishes, as Motion shows two children it can't tell apart (#286 would
 * key them).
 *
 * A leaving child that isn't a twin hands back the twins inside it (#181): each
 * crossfades onto its other twin while the child runs its own exit, and the child
 * goes once both have ended. Its exit's values reach the projection, so a twin
 * inside stays on its other twin while the exit moves or scales the child.
 */
import { children, createContext, createEffect, createMemo, createSignal, type JSX, onCleanup, onMount, untrack, useContext } from "solid-js"
import { exitCompleteEvents, makePresence, type PresenceMode } from "./presence-controller.ts"
import { useWardicProjection, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime } from "./provider.tsx"
import { isServer } from "./server.ts"
import type { PresenceContextValue } from "./presence-record.ts"

export { type PresenceContextValue, type PresenceRecord, presenceBlocksInitial, presenceHold } from "./presence-record.ts"
export type { PresenceMode } from "./presence-controller.ts"

/**
 * Context carrying the nearest `<AnimatePresence>`'s registrar. `undefined` when
 * there is no presence in scope — `createWard` then skips exit registration.
 */
export const PresenceContext = createContext<PresenceContextValue | undefined>(undefined)

/** Read the nearest {@link PresenceContext}, or `undefined` outside one. */
export const usePresenceContext = (): PresenceContextValue | undefined => useContext(PresenceContext)

/** {@link AnimatePresence}'s props. */
export interface AnimatePresenceProps {
  readonly children: JSX.Element
  /**
   * `false`: the child present at this presence's first render starts at its `animate`, with no
   * enter animation (it and every Wardic element under it, as Motion's); a child that enters later
   * animates in from its `initial`. Exits are unchanged (#134). On a server, the rendered child.
   */
  readonly initial?: boolean
  /**
   * Called once every exiting child has animated out and been removed (#257, Motion's prop): not
   * when a child comes back mid-exit, nor when the presence itself goes. Read when it's called.
   */
  readonly onExitComplete?: (() => void) | undefined
  /**
   * How a child enters while another exits (#277, ADR-0048), Motion's `mode`: `"sync"` (the default),
   * at once, beside the leaver; `"popLayout"`, at once, the leaver popped out of the flow where it was
   * (`position: absolute`, its size kept), so the children after it take their places, a `layout`
   * one animating there; `"wait"`, once every leaver has animated out and been removed. A
   * waiting child is built at once, as Solid builds it, so its own code (`onMount` included) runs
   * then, off the page; its Wardic elements start once it's on the page.
   */
  readonly mode?: PresenceMode | undefined
}

/**
 * `<AnimatePresence>` — wraps its children (a conditional one, or a `<For>`'s) and
 * animates each one's exit before it's removed. Must be used inside a `<WardicProvider>`
 * (it drives the exit on the provider runtime) and may wrap any control flow
 * (e.g. `<Show>`); the leaving child must be a `wardic.*` element / `createWard`
 * spine under this presence so it registers an exit record.
 */
export function AnimatePresence(props: AnimatePresenceProps): JSX.Element {
  const runtime = useWardicRuntime()
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()
  // A server render has no exit to drive and no runtime to log on: the same component
  // boundaries, with a context that registers nothing (ADR-0021).
  if (isServer) return serverPresence(props)
  // `mode="wait"`'s held children may go on the page (#277): the children are rendered again.
  const [released, release] = createSignal<void>(undefined, { equals: false })
  // The retained nodes, their exits and the twins they hand back (`presence-controller.ts`).
  const presence = makePresence({
    runtime,
    projection: useWardicProjection(),
    reducedMotion,
    positionalKeys,
    initial: () => props.initial,
    // Motion's `onExitComplete` (#257).
    events: exitCompleteEvents(runtime, () => untrack(() => props.onExitComplete)),
    mode: () => props.mode,
    release: () => release(),
  })
  // `initial={false}` (#134): the children set up with this first render start at their
  // `animate`; one that enters after it animates in.
  onMount(presence.mounted)

  // Inner tracker: resolved + the tracking effect MUST run UNDER the
  // PresenceContext.Provider, so the children's reactive owners are created
  // within the context and their `createWard` spines see `usePresenceContext()`.
  // (Resolving children() in the outer body would put their owners ABOVE the
  // provider and they'd never register an exit record.)
  const Tracker = (): JSX.Element => {
    // children() memoizes the resolved value; a <Show> flip changes what it
    // returns (the node -> undefined and back).
    const resolved = children(() => props.children)
    // What goes on the page (#277): every child, but under `mode="wait"` one entering is held off it
    // while a child exits. The controller is told what went on.
    const shown = createMemo(() => {
      released()
      return presence.shown(resolved())
    })
    createEffect(() => presence.present(shown()))
    return shown as unknown as JSX.Element
  }

  onCleanup(presence.teardown)

  return (
    <PresenceContext.Provider value={presence.context}>
      <Tracker />
    </PresenceContext.Provider>
  )
}

/** {@link AnimatePresence} during a server render: the client's boundaries, nothing to track. */
const serverPresence = (props: AnimatePresenceProps): JSX.Element => {
  // A server renders once: every child is set up with the first render (#134).
  const ctx: PresenceContextValue = { register: () => () => {}, blocksInitial: () => props.initial === false }
  const Tracker = (): JSX.Element => children(() => props.children) as unknown as JSX.Element
  return (
    <PresenceContext.Provider value={ctx}>
      <Tracker />
    </PresenceContext.Provider>
  )
}
