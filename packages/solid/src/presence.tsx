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
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, children, createContext, createEffect, createMemo, createSignal, type JSX, onCleanup, onMount, untrack, useContext } from "solid-js"
import { exitCompleteEvents, makePresence, type PresenceMode, propagateTo } from "./presence-controller.ts"
import { useBuiltProjection, useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime } from "./provider.tsx"
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
   * animates in from its `initial`. Exits are unchanged. On a server, the rendered child.
   */
  readonly initial?: boolean
  /**
   * Called once every exiting child has animated out and been removed (Motion's prop): not
   * when a child comes back mid-exit, nor when the presence itself goes. Read when it's called.
   */
  readonly onExitComplete?: (() => void) | undefined
  /**
   * How a child enters while another exits, Motion's `mode`: `"sync"` (the default),
   * at once, beside the leaver; `"popLayout"`, at once, the leaver popped out of the flow where it was
   * (`position: absolute`, its size kept), so the children after it take their places, a `layout`
   * one animating there; `"wait"`, once every leaver has animated out and been removed. A
   * waiting child is built at once, as Solid builds it, so its own code (`onMount` included) runs
   * then, off the page; its Wardic elements start once it's on the page.
   */
  readonly mode?: PresenceMode | undefined
  /**
   * What a leaving child's dynamic `exit` resolves with (Motion's `custom`), over the
   * child's own `custom`: a child that has left can't take new props, so the presence hands it the
   * latest. Read as each child leaves.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly custom?: any
  /**
   * Where `mode="popLayout"` pins a leaver (Motion's): by its inline start (`"left"`,
   * the default) or end (`"right"`), which a right-to-left layout flips, as Motion's does, and by its
   * `"top"` (the default) or `"bottom"`. Each edge keeps its distance from its container's while the
   * leaver exits, so one pinned by the bottom right stays in that corner as the container resizes.
   * Read as each leaver pops.
   */
  readonly anchorX?: "left" | "right" | undefined
  readonly anchorY?: "top" | "bottom" | undefined
  /**
   * Whether its children's going and coming moves the `layout` elements around them (Motion's
   * prop): `true` (the default) tells the projection when a child enters, a leaver pops or a leaver is
   * removed, so a `layout` sibling animates into or out of the space; `false` tells it nothing, and a
   * sibling animates only when something else measures it. Read at each change.
   */
  readonly presenceAffectsLayout?: boolean | undefined
  /**
   * Motion's `propagate`: inside another presence's child, when that child
   * leaves, this presence's children all leave too, each running its exit, and that child goes once
   * they've all gone. Without it (the default), its children go with that child, as they are. Read
   * once.
   */
  readonly propagate?: boolean
}

/**
 * `<AnimatePresence>` — wraps its children (a conditional one, or a `<For>`'s) and
 * animates each one's exit before it's removed. Must be used inside a `<WardicProvider>`
 * (it drives the exit on the provider runtime) and may wrap any control flow
 * (e.g. `<Show>`). A leaving child runs its own `exit` if it's a `wardic.*` element or a
 * `createWard` spine, and the exits of the Wardic elements inside it either way, staying until
 * they've ended; a plain child with nothing inside it to wait for goes at once.
 */
export function AnimatePresence(props: AnimatePresenceProps): JSX.Element {
  const runtime = useWardicRuntime()
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()
  const defaultTransition = useWardicDefaultTransition()
  // A server render has no exit to drive and no runtime to log on: the same component
  // boundaries, with a context that registers nothing (ADR-0021).
  if (isServer) return serverPresence(props)
  // `mode="wait"`'s held children may go on the page (#277): the children are rendered again.
  const [released, release] = createSignal<void>(undefined, { equals: false })
  // The retained nodes, their exits and the twins they hand back (`presence-controller.ts`).
  // The presence above, if any (#277's PR 5c): read before this one provides its own.
  const parent = usePresenceContext()
  const presence = makePresence({
    runtime,
    projection: useBuiltProjection(),
    reducedMotion,
    positionalKeys,
    defaultTransition,
    initial: () => props.initial,
    // Motion's `onExitComplete` (#257).
    events: exitCompleteEvents(runtime, () => untrack(() => props.onExitComplete)),
    mode: () => props.mode,
    custom: () => untrack(() => props.custom),
    anchorX: () => untrack(() => props.anchorX),
    anchorY: () => untrack(() => props.anchorY),
    presenceAffectsLayout: () => untrack(() => props.presenceAffectsLayout),
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

  // `propagate` (#277's PR 5c): with a presence above, its teardown waits to hear whether this one's
  // child left. Read before this presence provides its own context.
  onCleanup(propagateTo(parent, untrack(() => props.propagate) === true, presence))

  // Its `custom`, reactive, for `usePresenceData` (#277's PR 5b).
  const context: PresenceContextValue = { ...presence.context, data: () => props.custom }
  return (
    <PresenceContext.Provider value={context}>
      <Tracker />
    </PresenceContext.Provider>
  )
}

/** The element `target` is: an element, or an accessor of one; `undefined` before it has one. */
const elementOf = (target: unknown): Element | undefined => {
  if (Predicate.isFunction(target)) return asElement(target())
  return asElement(target)
}

/** `at`, if it's an element. */
const asElement = (at: unknown): Element | undefined => {
  if (at instanceof Element) return at
  return undefined
}

/** A presence hook's registration (#277's PR 5b): `isPresent`, `false` from its child's leave. */
const watchOf = (target: unknown, holds: boolean, onLeave: (safeToRemove: () => void, custom: unknown) => void): Accessor<boolean> => {
  const [present, setPresent] = createSignal(true)
  if (isServer) return present
  UndefinedOr.map(usePresenceContext(), (presence) =>
    UndefinedOr.map(presence.watch, (watch) =>
      watch({
        element: () => elementOf(target),
        holds,
        leave: (custom, release) => {
          setPresent(false)
          onLeave(release, custom)
        },
        gone: () => {},
      })))
  return present
}

/**
 * Motion's `usePresence`, in Solid's shape: the leaving child that holds
 * `target` (an element, or an accessor of one) stays until `safeToRemove` is called. `onLeave` is
 * called when it leaves, once its node is back in place (or popped, `mode="popLayout"`), with the
 * presence's `custom`: the child's own code is already disposed by then, so what it does there is
 * plain DOM work (a Web Animation, a timer) that ends by calling `safeToRemove`. Never at the
 * presence's own teardown, and outside a presence, never. One that throws is reported, and lets the
 * child go. Returns whether the child is present: `false` from its leave, for handlers still firing
 * on the retained node.
 */
export function usePresence(
  target: unknown,
  // Motion's `custom` is `any`: the callback declares its own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLeave: (safeToRemove: () => void, custom: any) => void,
): Accessor<boolean> {
  return watchOf(target, true, onLeave)
}

/**
 * Motion's `useIsPresent`: whether the child that holds `target` is present, `false`
 * from its leave on. The child's own effects are disposed as it leaves, so it's for what still runs
 * on the retained node: an event handler, a timer. Outside a presence, always `true`.
 */
export function useIsPresent(target: unknown): Accessor<boolean> {
  return watchOf(target, false, () => {})
}

/** Motion's `usePresenceData`: the nearest presence's `custom`, `undefined` outside one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePresenceData<T = any>(): Accessor<T | undefined> {
  const presence = usePresenceContext()
  return () => UndefinedOr.map(UndefinedOr.map(presence, (p) => p.data), (data) => data()) as T | undefined
}

/** {@link AnimatePresence} during a server render: the client's boundaries, nothing to track. */
const serverPresence = (props: AnimatePresenceProps): JSX.Element => {
  // A server renders once: every child is set up with the first render (#134).
  const ctx: PresenceContextValue = { register: () => () => {}, blocksInitial: () => props.initial === false, data: () => props.custom }
  const Tracker = (): JSX.Element => children(() => props.children) as unknown as JSX.Element
  return (
    <PresenceContext.Provider value={ctx}>
      <Tracker />
    </PresenceContext.Provider>
  )
}
