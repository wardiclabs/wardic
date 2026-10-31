/**
 * `createAnimate()` on Solid 2 (#433, Motion's `useAnimate`): the Solid 1 binding's, its **Animation
 * scope** with an async value of its own, `scope.settled()` (#433's Q8): pending while any animation
 * it started is in flight, so `isPending(() => scope.settled())` reads "animating", as a ward's
 * `settled()` does (ADR-0046).
 *
 * @module
 */
import { isServer } from "@solidjs/web"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createMemo, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js"
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
import { CLIENT_ONLY } from "./solid-reactivity.ts"

/**
 * A scope's landing (#433's Q8): the animation that landed last. Held in an object, as the controls
 * are awaitable, which an async value would wait on rather than hold.
 */
export interface WardicScopeLanding {
  readonly animation: WardicPlaybackControls
}

/** An **Animation scope** on Solid 2 (#433): the Solid 1 binding's, with {@link settled}. */
export interface WardicAnimationScopeV2<T extends Element = HTMLElement> extends WardicAnimationScope<T> {
  /**
   * Its last landing (#433's Q8), `undefined` before the first: an async value, pending while any
   * animation it started is in flight, as a ward's `settled()` is (ADR-0046). One stopped or cancelled
   * ends its flight without landing.
   */
  readonly settled: () => WardicScopeLanding | undefined
}

/** `scope.settled()` (#433's Q8): its animations in flight, counted, made reactive at its first read. */
const settledOf = (): { readonly watch: AnimationWatch; readonly read: () => WardicScopeLanding | undefined } => {
  const owner = getOwner()
  let flying = 0
  let last: WardicScopeLanding | undefined
  let setCount: ((count: number) => void) | undefined
  let memo: Accessor<WardicScopeLanding | undefined> | undefined
  let waiting: ((landed: WardicScopeLanding | undefined) => void) | undefined
  const tell = (): void => {
    UndefinedOr.map(setCount, (set) => set(flying))
  }
  // Its count starts at none in flight, so its first read is never pending; one in flight then is
  // set from a microtask, as a ward's Retarget in flight is: a start comes in Solid's flush.
  const make = (): Accessor<WardicScopeLanding | undefined> => {
    const [count, set] = createSignal(0)
    setCount = set
    const made = createMemo((): WardicScopeLanding | undefined | PromiseLike<WardicScopeLanding | undefined> => {
      if (count() === 0) return last
      return new Promise<WardicScopeLanding | undefined>((resolve) => {
        waiting = resolve
      })
    }, CLIENT_ONLY)
    if (flying > 0) queueMicrotask(tell)
    return made
  }
  const watch: AnimationWatch = {
    started: () => {
      flying++
      if (Predicate.isNotUndefined(setCount)) queueMicrotask(tell)
    },
    ended: (controls, landed) => {
      flying--
      if (landed) last = { animation: controls }
      if (flying > 0) return
      const resolve = waiting
      waiting = undefined
      UndefinedOr.map(resolve, (done) => done(last))
      tell()
    },
  }
  const read = (): WardicScopeLanding | undefined => {
    if (Predicate.isUndefined(memo)) memo = runWithOwner(owner, make)
    return (memo as Accessor<WardicScopeLanding | undefined>)()
  }
  return { watch, read }
}

/**
 * An **Animation scope** and its `animate` (#433, Motion's `useAnimate`), as the Solid 1 binding's
 * `createAnimate`, its scope with `settled()`. Made in a component under a `WardicProvider`, whose
 * cleanup stops its animations.
 *
 * @example
 * const [scope, animate] = createAnimate()
 * const reveal = () => animate("li", { opacity: [0, 1] }, { delay: (i) => i * 0.05 })
 * <button disabled={isPending(() => scope.settled())} onClick={reveal}>…</button>
 * <ul ref={scope}>…</ul>
 */
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
