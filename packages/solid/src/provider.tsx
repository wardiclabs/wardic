/**
 * `WardicProvider` — owns the single Effect runtime for a Solid subtree.
 *
 * Per ADR-0006 ("Reactive bridge"), exactly one Effect runtime + `AtomRegistry`
 * lives in `WardicProvider`, and every animation fiber is scoped to a consuming
 * component's `onCleanup`, so unmount interrupts the fiber, tears down its
 * Scope, and drops the ref-count on the Shared sources it subscribed to.
 *
 * This module supplies that runtime (a `ManagedRuntime` built once from the
 * supplied environment `Layer`), the `useWardicRuntime` accessor, and the
 * scoped-fiber runner (`runScoped` / `useWardicFiber`) that interrupts forked
 * fibers on consumer unmount.
 */
import type { Clock, InputSource, InterpolatorRegistry, Probe, Renderer } from "@wardic/core"
import type { Effect } from "effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import type { AtomRegistry } from "effect/unstable/reactivity"
import { createContext, onCleanup, useContext } from "solid-js"
import type { JSX } from "solid-js"
import { makeProjectionSystem, type ProjectionSystem } from "@wardic/dom"
import { type FlushGate, makeFlushGate } from "./gate.ts"
import { makeSharedLayoutRegistry, SharedLayoutContext } from "./layout.tsx"

/**
 * The full Wardic environment a `WardicProvider` requires: all five core
 * service contracts plus the `AtomRegistry` that backs reactive service inputs.
 * Satisfied by `@wardic/dom`'s `DomLive` (real browser) or `@wardic/test`'s
 * `TestLive` (headless). `ER` and `R` are `never`: a fully self-contained Layer.
 */
export type WardicEnv = Layer.Layer<
  Clock | Renderer | InputSource | Probe | InterpolatorRegistry | AtomRegistry.AtomRegistry,
  never,
  never
>

/** The runtime services a `WardicProvider` makes available to its subtree. */
export type WardicServices = Clock | Renderer | InputSource | Probe | InterpolatorRegistry | AtomRegistry.AtomRegistry

/** The `ManagedRuntime` flavour built from a {@link WardicEnv}. */
export type WardicRuntime = ManagedRuntime.ManagedRuntime<WardicServices, never>

/**
 * The value a `WardicProvider` carries down the tree: the single Effect runtime
 * plus the provider-owned flush gate (ADR-0006) built atop it.
 */
interface WardicContextValue {
  readonly runtime: WardicRuntime
  readonly gate: FlushGate
  readonly projection: ProjectionSystem
}

/**
 * Context carrying the single runtime + flush gate down the tree. Defaults to
 * `undefined` so {@link useWardicRuntime} / {@link useWardicGate} can detect
 * (and clearly reject) reads made outside a `WardicProvider`.
 */
const WardicContext = createContext<WardicContextValue | undefined>(undefined)

/**
 * Provides a single Effect runtime (built once from `env`) to its subtree.
 *
 * Builds `ManagedRuntime.make(env)` exactly once for the lifetime of the
 * component, exposes it through context, and disposes it on unmount
 * (fire-and-forget — `dispose` returns a `Promise`). `env` is required; pass
 * `DomLive` (browser) or `TestLive` (tests).
 */
export function WardicProvider(props: {
  readonly env: WardicEnv
  readonly children?: JSX.Element
}): JSX.Element {
  // Built ONCE — props.env is read a single time at construction. The runtime
  // owns the Layer's scope for the component's lifetime.
  const runtime = ManagedRuntime.make(props.env)
  // The flush gate is a provider-owned singleton (one per WardicProvider),
  // built atop the runtime (ADR-0006). It resolves the Renderer once at
  // construction.
  const gate = makeFlushGate(runtime)

  // The shared-layout registry is provided AT THE ROOT (ADR-0005) so `layoutId`
  // shared-element FLIP works with NO `<LayoutGroup>` (Motion parity). Built
  // once per provider; a future `<LayoutGroup>` MAY re-provide a nested one to
  // namespace ids (an element resolves the NEAREST registry).
  const sharedLayout = makeSharedLayoutRegistry()

  // The box-based projection system (ADR-0009) — provider-owned like the gate.
  // It holds the projection nodes + the Clock-driven coordinator; standalone
  // `layout` elements register with it (a future <LayoutGroup> uses the tree too).
  const projection = makeProjectionSystem(runtime, gate)

  onCleanup(() => {
    // Interrupt the projection coordinator + drop its observer first, then cancel
    // any pending frame and clear the gate, before tearing down the runtime the
    // gate runs commit sinks on.
    projection.dispose()
    gate.dispose()
    // dispose() returns a Promise; fire-and-forget on unmount.
    void runtime.dispose()
  })

  return (
    <WardicContext.Provider value={{ runtime, gate, projection }}>
      <SharedLayoutContext.Provider value={sharedLayout}>{props.children}</SharedLayoutContext.Provider>
    </WardicContext.Provider>
  )
}

/**
 * Reads the Wardic runtime from context.
 *
 * Throws a clear, named error when called outside a `WardicProvider`. Must be
 * called within a Solid owner (component body / `createRoot`).
 */
export function useWardicRuntime(): WardicRuntime {
  const value = useContext(WardicContext)
  if (value === undefined) {
    throw new Error("useWardicRuntime must be used within a <WardicProvider>")
  }
  return value.runtime
}

/**
 * Reads the provider-owned flush gate from context (ADR-0006).
 *
 * Throws a clear, named error when called outside a `WardicProvider` (mirrors
 * {@link useWardicRuntime}). Must be called within a Solid owner (component
 * body / `createRoot`).
 */
export function useWardicGate(): FlushGate {
  const value = useContext(WardicContext)
  if (value === undefined) {
    throw new Error("useWardicGate must be used within a <WardicProvider>")
  }
  return value.gate
}

/**
 * Reads the provider-owned projection system (ADR-0009 — the box-based layout
 * engine). Throws a clear, named error outside a `WardicProvider`. Must be called
 * within a Solid owner.
 */
export function useWardicProjection(): ProjectionSystem {
  const value = useContext(WardicContext)
  if (value === undefined) {
    throw new Error("useWardicProjection must be used within a <WardicProvider>")
  }
  return value.projection
}

/**
 * Forks `effect` on `runtime` and interrupts the resulting fiber on the current
 * component's unmount.
 *
 * Must be called within a Solid owner (it registers `onCleanup`). The forked
 * fiber's Scope is torn down on interrupt, releasing whatever Shared sources it
 * subscribed to — exactly the per-element fiber lifecycle ADR-0006 prescribes.
 *
 * @returns the running fiber, in case the caller wants to await or join it.
 */
export function runScoped<A, E>(
  runtime: WardicRuntime,
  effect: Effect.Effect<A, E, WardicServices>,
): Fiber.Fiber<A, E> {
  const fiber = runtime.runFork(effect)
  onCleanup(() => {
    // Interrupting is itself an Effect; fork it on the runtime so it runs
    // without blocking the synchronous cleanup pass.
    runtime.runFork(Fiber.interrupt(fiber))
  })
  return fiber
}

/**
 * Convenience hook: reads the provider's runtime and {@link runScoped}s the
 * Effect produced by `effectThunk` in the current owner.
 *
 * The thunk is evaluated once, when the hook is called. Must be used within a
 * `WardicProvider` and a Solid owner.
 */
export function useWardicFiber<A, E>(
  effectThunk: () => Effect.Effect<A, E, WardicServices>,
): Fiber.Fiber<A, E> {
  return runScoped(useWardicRuntime(), effectThunk())
}
