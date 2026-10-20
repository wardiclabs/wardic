/**
 * `WardicProvider` for Solid 2 (`@wardic/solid/unstable/v2`, #209): one Effect runtime for a
 * subtree, as the Solid 1 binding's provider (`../../provider.tsx`), over the same runtime and
 * services (`../../runtime.ts`). What Solid 2 changes:
 *
 * - **No `batch`.** Solid 2 batches every update on a microtask, and a read lags its setter until
 *   then. The flush gate needs a frame's Starting-style switches to have reached the elements
 *   before it commits (ADR-0034), so it gets apply-then-`flush()`: the switches set their signals,
 *   and `flush()` drains them at once. The gate runs them from its frame flush, outside any owner,
 *   where Solid 2 lets a signal be written.
 * - **A context value is its own provider** (`<WardicContext value={…}>`).
 * - **`onSettled`** opens the Hydration hold where Solid 1 had `onMount`.
 * - **A server render starts no Appear animation yet.** Solid 2's `@solidjs/web` has no
 *   `useAssets` for the head's `<style>`; elements keep their Starting style until mount, as with
 *   `appear={false}`. PR 4 of #209 brings it.
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constUndefined } from "effect/Function"
import * as Latch from "effect/Latch"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { isServer, type JSX } from "@solidjs/web"
import { createContext, flush, isHydrating, onCleanup, onSettled, untrack, useContext } from "solid-js"
import type { ServerAppear } from "../../appear.ts"
import {
  type AnimateLayout,
  animateLayoutOf,
  clientContext,
  fromContext,
  interrupted,
  projectionOf,
  reported,
  serverContext,
  type WardicContextValue,
  type WardicEnv,
  type WardicRuntime,
  type WardicServices,
} from "../../runtime.ts"

/** A frame's Starting-style switches, applied and drained before the gate commits (ADR-0034): Solid 2's `batch`. */
const applyAndFlush = (apply: () => void): void => {
  apply()
  flush()
}

/**
 * The runtime and services a provider carries down its subtree; `null` outside one. Solid 2 takes
 * an `undefined` default for none, and its `useContext` then throws its own error outside a
 * provider: `null` keeps Wardic's, which names the hook.
 */
const WardicContext = createContext<WardicContextValue | null>(null)

/** The nearest provider's value, `undefined` outside one. */
const contextValue = (): WardicContextValue | undefined => Option.getOrUndefined(Option.fromNullishOr(useContext(WardicContext)))

/**
 * Provides a single Effect runtime, built once from `env`, to its subtree, as the Solid 1 binding's
 * `WardicProvider` does: built on first need (#51), disposed on unmount, inert during a server
 * render (ADR-0021). `reducedMotion` (ADR-0029) is read when each animation starts.
 */
export function WardicProvider(props: {
  readonly env: WardicEnv
  readonly reducedMotion?: ReducedMotion.Config | undefined
  readonly children?: JSX.Element
}): JSX.Element {
  const value = Bool.match(isServer, {
    onTrue: () => serverContext(props.env, undefined),
    onFalse: () => clientContext(props.env, applyAndFlush, () => untrack(() => props.reducedMotion)),
  })
  // Disposing the runtime closes its Scope: the projection system, then the gate (#132).
  onCleanup(() => void value.runtime.dispose())
  return <WardicContext value={value}>{props.children}</WardicContext>
}

/** A server render's Appear animations; none yet on Solid 2 (see the module). Internal. */
export function useWardicAppear(): ServerAppear | undefined {
  return UndefinedOr.match(contextValue(), { onUndefined: constUndefined, onDefined: (value) => value.appear })
}

/** The provider's Effect runtime; a clear error outside one. Unbuilt during a server render (ADR-0021). */
export function useWardicRuntime(): WardicRuntime {
  return fromContext(contextValue(), "useWardicRuntime", (value) => value.runtime)
}

/** The provider's flush gate (ADR-0006); inert during a server render. */
export function useWardicGate(): FlushGate.Shape {
  return fromContext(contextValue(), "useWardicGate", (value) => value.gate)
}

/** The Environment's Positional keys (ADR-0036): which keys reduced motion Snaps. Internal. */
export function useWardicPositionalKeys(): ReducedMotion.PositionalKeys["Service"] {
  return fromContext(contextValue(), "useWardicPositionalKeys", (value) => value.positionalKeys)
}

/** Whether reduced motion applies now (ADR-0029); always `false` during a server render. Internal. */
export function useWardicReducedMotion(): () => boolean {
  return fromContext(contextValue(), "useWardicReducedMotion", (value) => value.reducedMotion)
}

/** The provider's projection system (ADR-0009); a clear error during a server render, which builds none. */
export function useWardicProjection(): ProjectionSystem.Shape {
  return projectionOf(contextValue())
}

/** The provider's `animateLayout` (#4, ADR-0038): a **Declared layout change**. During a server render it just runs `fn`. */
export function useAnimateLayout(): AnimateLayout {
  return animateLayoutOf(contextValue())
}

/**
 * Forks `effect` on `runtime` and interrupts the fiber when the current owner is disposed, as the
 * Solid 1 binding's `runScoped` does. A server render starts nothing; while hydrating the fiber
 * exists at once and its effect starts once the owner has settled (the Hydration hold, ADR-0021).
 */
export function runScoped<A, E>(runtime: WardicRuntime, effect: Effect.Effect<A, E, WardicServices>): Fiber.Fiber<A, E> {
  if (isServer) return interrupted<A, E>()
  const run = reported(effect)
  if (isHydrating()) {
    const latch = Latch.makeUnsafe(false)
    const held = runtime.runFork(Effect.andThen(latch.await, run))
    onSettled(() => {
      Effect.runSync(latch.open)
    })
    onCleanup(() => {
      runtime.runFork(Fiber.interrupt(held))
    })
    return held
  }
  const fiber = runtime.runFork(run)
  onCleanup(() => {
    runtime.runFork(Fiber.interrupt(fiber))
  })
  return fiber
}

/** {@link runScoped}s the Effect `effectThunk` makes, on the provider's runtime. Evaluated once; not on a server. */
export function useWardicFiber<A, E>(effectThunk: () => Effect.Effect<A, E, WardicServices>): Fiber.Fiber<A, E> {
  const runtime = useWardicRuntime()
  if (isServer) return interrupted<A, E>()
  return runScoped(runtime, effectThunk())
}
