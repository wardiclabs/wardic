/**
 * Where the binding renders (ADR-0021, decision 3). The ONE server check in
 * `@wardic/solid` is Solid's `isServer`: it says what Solid is doing (rendering to a
 * string), not which globals exist, so a server that defines `window` (a jsdom test) is
 * still a server. Internal, not a package export.
 *
 * A server render builds no runtime; a hydrating client renders what the server rendered
 * until the element mounts (the **Hydration hold**, decision 8), then runs as a
 * client-only render does.
 */
import { type Accessor, createSignal, onMount, sharedConfig } from "solid-js"

export { isServer } from "solid-js/web"

/**
 * Whether this setup runs inside a hydration of server-rendered markup: Solid 1.9 sets
 * `sharedConfig.context` for the length of `hydrate()` (web/dist/web.js:357-366; its own
 * `isHydrating` isn't exported). Read it at setup. Solid 2's flag differs (see
 * docs/plans/upgrade-targets.md).
 */
export const isHydrating = (): boolean => sharedConfig.context != null

/** `false` until the owner mounts, then `true`. A server never flips it. */
export const createMounted = (): Accessor<boolean> => {
  const [mounted, setMounted] = createSignal(false)
  onMount(() => setMounted(true))
  return mounted
}
