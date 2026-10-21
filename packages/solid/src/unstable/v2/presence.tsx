/**
 * `<AnimatePresence>` on Solid 2 (#209, ADR-0007): exit-before-unmount for a single child, as the
 * Solid 1 binding's. Its work (the retained node, its parent-driven exit, the twins it hands back,
 * a re-entry's interrupt) is Solid-free, in `presence-controller.ts`. What's Solid 2's:
 *
 * - **The child is resolved with `children()`** under the presence's context, so the child's ward
 *   registers its exit record with it.
 * - **An effect tells the controller which element is present,** in its apply: after Solid 2's
 *   flush has applied the change, the leaving node removed. The controller puts it back before the
 *   flush ends, so no paint shows it gone.
 * - **Once settled** (`onSettledClientOnly`), the first render has ended, for `initial={false}` (#134).
 *
 * @module
 */
import { isServer, type JSX } from "@solidjs/web"
import * as Option from "effect/Option"
import { children, createContext, createEffect, onCleanup, untrack, useContext } from "solid-js"
import { makePresence } from "../../presence-controller.ts"
import type { PresenceContextValue } from "../../presence-record.ts"
import { useWardicPositionalKeys, useWardicProjection, useWardicReducedMotion, useWardicRuntime } from "./provider.tsx"
import { CLIENT_ONLY, onSettledClientOnly } from "./solid-reactivity.ts"

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
}

/**
 * Wraps a single, often conditional, child (`<Show>`) and animates its exit before it's removed.
 * The child is a `wardic.*` element or an element with a ward on it, whose config's `exit` is the
 * exit's target. Inside a `<WardicProvider>`.
 */
export function AnimatePresence(props: AnimatePresenceProps): JSX.Element {
  // A server render has no exit to drive: the same boundaries, a context that registers nothing.
  // eslint-disable-next-line solid/components-return-once -- `isServer` is a constant: the component takes one path for its life
  if (isServer) return serverPresence(props)
  const presence = makePresence({
    runtime: useWardicRuntime(),
    projection: useWardicProjection(),
    reducedMotion: useWardicReducedMotion(),
    positionalKeys: useWardicPositionalKeys(),
    initial: () => untrack(() => props.initial),
  })
  onSettledClientOnly(presence.mounted)
  onCleanup(presence.teardown)

  // Resolved under the context, so the child's ward sees it.
  const Tracker = (): JSX.Element => {
    const resolved = children(() => props.children)
    createEffect(
      resolved,
      (current) => {
        presence.present(current)
      },
      CLIENT_ONLY,
    )
    return resolved as unknown as JSX.Element
  }

  return (
    <PresenceContext value={presence.context}>
      <Tracker />
    </PresenceContext>
  )
}

/** {@link AnimatePresence} during a server render: the client's boundaries, nothing to track. */
const serverPresence = (props: AnimatePresenceProps): JSX.Element => {
  // A server renders once: every child is set up with the first render (#134).
  const context: PresenceContextValue = { register: () => () => {}, blocksInitial: () => untrack(() => props.initial) === false }
  const Tracker = (): JSX.Element => children(() => props.children) as unknown as JSX.Element
  return (
    <PresenceContext value={context}>
      <Tracker />
    </PresenceContext>
  )
}
