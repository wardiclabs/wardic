/**
 * `createAnimate()` on Solid 2 (#433, Motion's `useAnimate`): the Solid 1 binding's, its **Animation
 * scope** with an async value of its own, `scope.settled()` (#433's Q8): pending while any animation
 * it started is in flight, so `isPending(() => scope.settled())` reads "animating", as a ward's
 * `settled()` does (ADR-0046).
 *
 * @module
 */
import { isServer } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { onCleanup } from "solid-js"
import {
  type AnimateEnv,
  type AnimationWatch,
  scopedAnimate,
  scopeOf,
  serverAnimate,
  type WardicAnimate,
  type WardicAnimationScope,
  type WardicPlaybackControls,
} from "../../imperative.ts"
import { useWardicDefaultTransition, useWardicGate, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import { flightsOf } from "./flights.ts"

/** A scope's landing: the animation that landed last, as `scope.settled()` gives it. */
// #433's Q8: held in an object, as the controls are awaitable, which an async value would wait on
// rather than hold.
export interface WardicScopeLanding {
  readonly animation: WardicPlaybackControls
}

/** An animation scope on Solid 2: Solid 1's, with `settled()`. */
// #433.
export interface WardicAnimationScopeV2<T extends Element = HTMLElement> extends WardicAnimationScope<T> {
  /**
   * Its last landing, `undefined` before the first: an async value, pending while any animation it
   * started is in flight, as a ward's `settled()` is, so `isPending(() => scope.settled())` reads
   * "animating". One stopped or cancelled ends its flight without landing.
   */
  readonly settled: () => WardicScopeLanding | undefined
}

/** `scope.settled()` (#433's Q8): its animations in flight, counted, made reactive at its first read. */
const settledOf = (): { readonly watch: AnimationWatch; readonly read: () => WardicScopeLanding | undefined } => {
  const flights = flightsOf<WardicScopeLanding>()
  const watch: AnimationWatch = {
    started: () => flights.started(),
    ended: (controls, landed) => flights.ended(Bool.match(landed, { onTrue: () => ({ animation: controls }), onFalse: () => undefined })),
  }
  return { watch, read: flights.read }
}

/**
 * Animates elements from code, Wardic's and plain ones alike: returns a scope, given to an element's
 * `ref`, and `animate`. `animate(subject, target, options?)` animates an element, the elements a
 * selector finds inside the scope, or a list; `animate(sequence)` plays a sequence. Each returns its
 * playback controls, which can be awaited. `scope.settled()` is pending while its animations are in
 * flight. Call it in a component under a `WardicProvider`; the component's cleanup stops its
 * animations. Motion's `useAnimate`.
 *
 * @example
 * const [scope, animate] = createAnimate()
 * const reveal = () => animate("li", { opacity: [0, 1] }, { delay: stagger(0.05) })
 * <button disabled={isPending(() => scope.settled())} onClick={reveal}>Reveal</button>
 * <ul ref={scope}>…</ul>
 * @see https://wardic.dev/reference/solid/animation/create-animate
 */
// #433, as Solid 1's; `settled()` is #433's Q8, as a ward's (ADR-0046).
export function createAnimate<T extends Element = HTMLElement>(): readonly [WardicAnimationScopeV2<T>, WardicAnimate] {
  const settled = settledOf()
  const made = scopeOf<T>(settled.watch)
  const scope = Object.defineProperty(made.scope, "settled", { value: settled.read }) as WardicAnimationScopeV2<T>
  // A server animates nothing (#433's defaults).
  if (isServer) return [scope, serverAnimate] as const
  const env: AnimateEnv = {
    runtime: useWardicRuntime(),
    gate: useWardicGate(),
    reducedMotion: useWardicReducedMotion(),
    skipAnimations: useWardicSkipAnimations(),
    positionalKeys: useWardicPositionalKeys(),
    defaultTransition: useWardicDefaultTransition(),
  }
  onCleanup(made.stopAll)
  return [scope, scopedAnimate(env, () => scope.current, made.watch)] as const
}
