/**
 * `createAnimate()` (#433, Motion's `useAnimate`): an **Animation scope** and its `animate`, for
 * **Imperative animations** of the elements in it, Wardic's and plain ones (`imperative.ts`).
 *
 * @module
 */
import { onCleanup } from "solid-js"
import { type AnimateEnv, scopedAnimate, scopeOf, serverAnimate, type WardicAnimate, type WardicAnimationScope } from "./imperative.ts"
import { useWardicDefaultTransition, useWardicGate, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime } from "./provider.tsx"
import { isServer } from "./server.ts"

/**
 * An **Animation scope** and its `animate` (#433, Motion's `useAnimate`), made in a component under a
 * `WardicProvider`, whose cleanup stops its animations.
 *
 * - `<ul ref={scope}>` gives it its element, `scope.current`.
 * - `animate(scope.current, { opacity: 1 })` animates an element; `animate("li", target, options)`
 *   the elements a selector finds inside the scope; a list, each of them, `delay` a function of each
 *   one's index and their count.
 * - On a Wardic element it takes the keys it animates: they stay where it leaves them until the
 *   element's own target for them changes, as in Motion.
 * - It returns its **Playback controls**: awaitable, with `stop`, `cancel`, `complete`, `pause`,
 *   `play`, `speed`, `time` (set, it seeks) and `duration`.
 *
 * @example
 * const [scope, animate] = createAnimate()
 * onMount(() => animate("li", { opacity: [0, 1], y: [8, 0] }, { delay: (i) => i * 0.05 }))
 * return <ul ref={scope}>…</ul>
 */
export function createAnimate<T extends Element = HTMLElement>(): readonly [WardicAnimationScope<T>, WardicAnimate] {
  const made = scopeOf<T>()
  // A server animates nothing (#433's defaults).
  if (isServer) return [made.scope, serverAnimate] as const
  const env: AnimateEnv = {
    runtime: useWardicRuntime(),
    gate: useWardicGate(),
    reducedMotion: useWardicReducedMotion(),
    positionalKeys: useWardicPositionalKeys(),
    defaultTransition: useWardicDefaultTransition(),
  }
  onCleanup(made.stopAll)
  return [made.scope, scopedAnimate(env, () => made.scope.current, made.watch)] as const
}
