/**
 * `createAnimate()` (#433, Motion's `useAnimate`): an **Animation scope** and its `animate`, for
 * **Imperative animations** of the elements in it, Wardic's and plain ones (`imperative.ts`).
 *
 * @module
 */
import { onCleanup } from "solid-js"
import { type AnimateEnv, scopedAnimate, scopeOf, serverAnimate, type WardicAnimate, type WardicAnimationScope } from "./imperative.ts"
import { useWardicDefaultTransition, useWardicGate, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import { isServer } from "./server.ts"

/**
 * Animates elements from code, Wardic's and plain ones alike: returns a scope, given to an element's
 * `ref`, and `animate`. `animate(subject, target, options?)` animates an element, the elements a
 * selector finds inside the scope, or a list; `animate(sequence)` plays a sequence. Each returns its
 * playback controls, which can be awaited. On a Wardic element, the keys it animates stay where it
 * leaves them until the element's own target for them changes. Call it in a component under a
 * `WardicProvider`; the component's cleanup stops its animations. Motion's `useAnimate`.
 *
 * @example
 * const [scope, animate] = createAnimate()
 * onMount(() => animate("li", { opacity: [0, 1], y: [8, 0] }, { delay: stagger(0.05) }))
 * <ul ref={scope}>…</ul>
 * @see https://wardic.dev/reference/solid/animation/create-animate
 */
// #433. A plain element animates through a spine of its own (imperative.ts).
export function createAnimate<T extends Element = HTMLElement>(): readonly [WardicAnimationScope<T>, WardicAnimate] {
  const made = scopeOf<T>()
  // A server animates nothing (#433's defaults).
  if (isServer) return [made.scope, serverAnimate] as const
  const env: AnimateEnv = {
    runtime: useWardicRuntime(),
    gate: useWardicGate(),
    reducedMotion: useWardicReducedMotion(),
    skipAnimations: useWardicSkipAnimations(),
    positionalKeys: useWardicPositionalKeys(),
    defaultTransition: useWardicDefaultTransition(),
  }
  onCleanup(made.stopAll)
  return [made.scope, scopedAnimate(env, () => made.scope.current, made.watch)] as const
}
