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
import type * as Clock from "@wardic/core/Clock"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InputSource from "@wardic/core/InputSource"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Probe from "@wardic/core/Probe"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constFalse } from "effect/Function"
import * as Latch from "effect/Latch"
import type * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import { AtomRegistry } from "effect/reactivity"
import { batch, createContext, onCleanup, onMount, untrack, useContext } from "solid-js"
import type { JSX } from "solid-js"
import { type FlushGate, INERT_GATE, makeFlushGate, makeProjectionSystem, type ProjectionSystem, reportFailure } from "@wardic/dom"
import { isHydrating, isServer } from "./server.ts"

/**
 * The full Wardic environment a `WardicProvider` requires: all five core
 * service contracts, the `RefreshFrameSource` the Clock ticks on and the flush gate requests its
 * flushes from (ADR-0031), core's Frame loop over the Clock (`FrameLoop.layer`, which runs every
 * animation the binding starts, ADR-0027), and the `AtomRegistry` that backs reactive service
 * inputs. Satisfied by `@wardic/dom`'s `DomLive` (real browser) or `@wardic/test`'s
 * `TestLive` (headless). `ER` and `R` are `never`: a fully self-contained Layer.
 */
export type WardicEnv = Layer.Layer<WardicServices, never, never>

/** The runtime services a `WardicProvider` makes available to its subtree. */
export type WardicServices =
  | Clock.Clock
  | RefreshFrameSource.RefreshFrameSource
  | FrameLoop.FrameLoop
  | Renderer.Renderer
  | InputSource.InputSource
  | Probe.Probe
  | InterpolatorRegistry.InterpolatorRegistry
  | AtomRegistry.AtomRegistry

/** The `ManagedRuntime` flavour built from a {@link WardicEnv}. */
export type WardicRuntime = ManagedRuntime.ManagedRuntime<WardicServices, never>

/**
 * The value a `WardicProvider` carries down the tree: the single Effect runtime
 * plus the provider-owned flush gate (ADR-0006) built atop it.
 */
interface WardicContextValue {
  readonly runtime: WardicRuntime
  readonly gate: FlushGate
  /** `undefined` during a server render, which builds no projection system (ADR-0021). */
  readonly projection: ProjectionSystem | undefined
  /** Whether reduced motion applies now (ADR-0029): read when each animation starts. */
  readonly reducedMotion: () => boolean
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
 *
 * The runtime is client-only (ADR-0021). During a server render the provider builds
 * nothing: it holds an unbuilt runtime, an inert gate and no projection system, and its
 * subtree renders each element's Starting style. Running anything on the runtime then
 * fails with DomLive's client-only error, so run Effects on it once the element has
 * mounted: in Solid 1, from `onMount` or a `createEffect`; in Solid 2, from `onSettled`,
 * an effect's effect half, or a computation marked `ssrSource: "client"`.
 *
 * `reducedMotion` is how animations honour the user's `prefers-reduced-motion` (ADR-0029,
 * Motion's `MotionConfig` `reducedMotion`): `"user"`, the default, follows it; `"always"`
 * reduces motion whatever it is; `"never"` animates whatever it is. Under reduced motion an
 * animation's positional keys (its transforms, and the box's position and size) snap to where it
 * would end, and the rest (opacity, colour, …) animate; a layout animation lands at once, and so
 * does a presence exit's move. It's read when each animation starts, and a transition opts out
 * with `respectReducedMotion: false`.
 */
export function WardicProvider(props: {
  readonly env: WardicEnv
  readonly reducedMotion?: ReducedMotion.Config | undefined
  readonly children?: JSX.Element
}): JSX.Element {
  if (isServer) {
    // A server render builds no runtime (ADR-0021, decisions 1 and 3): `make` alone
    // builds nothing (0.92 µs), so code that grabs the runtime at setup and uses it after
    // mount keeps working. Same JSX as the client, so the hydration keys match.
    const runtime = ManagedRuntime.make(props.env)
    // Nothing builds it here, but an Environment that builds on a server (TestLive) could
    // be built by user code: dispose it with the render, as the client does on unmount.
    onCleanup(() => void runtime.dispose())
    return (
      <WardicContext.Provider value={{ runtime, gate: INERT_GATE, projection: undefined, reducedMotion: constFalse }}>
        {props.children}
      </WardicContext.Provider>
    )
  }

  // Built ONCE — props.env is read a single time at construction. The runtime
  // owns the Layer's scope for the component's lifetime.
  const runtime = ManagedRuntime.make(props.env)
  // The flush gate is a provider-owned singleton (one per WardicProvider),
  // built atop the runtime (ADR-0006). It's dom's, framework-free, and applies each
  // flush in Solid's `batch()`; it resolves the Renderer and the Environment's
  // Refresh frame source once at construction (ADR-0031).
  const gate = makeFlushGate(runtime, { batch })

  // Whether reduced motion applies now (ADR-0029): the app's setting, untracked so a change to it
  // never Retargets, and the user's preference through the Probe's atom. Read when each animation
  // starts, so a change applies from the next one.
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  const probe = runtime.runSync(Probe.Probe)
  const reducedMotion = (): boolean =>
    ReducedMotion.applies(
      Option.getOrElse(Option.fromUndefinedOr(untrack(() => props.reducedMotion)), () => "user" as const),
      registry.get(probe.prefersReducedMotion),
    )

  // The box-based projection system (ADR-0009) — provider-owned like the gate.
  // It holds the projection nodes + the coordinator (a run on the Frame loop); standalone
  // `layout` elements register with it (a future <LayoutGroup> uses the tree too).
  // It also owns `layoutId` matching end to end — the lead/follow stack AND the
  // Switch seed (ADR-0010 *Amendment (#13)*) — so `layoutId` works with NO
  // `<LayoutGroup>` (Motion parity) and the binding keeps no registry.
  const projection = makeProjectionSystem(runtime, gate, { reducedMotion })

  onCleanup(() => {
    // Stop the projection coordinator's run + drop its observer first, then cancel
    // any pending frame and clear the gate, before tearing down the runtime the
    // gate runs commit sinks on.
    projection.dispose()
    gate.dispose()
    // dispose() returns a Promise; fire-and-forget on unmount.
    void runtime.dispose()
  })

  return (
    <WardicContext.Provider value={{ runtime, gate, projection, reducedMotion }}>{props.children}</WardicContext.Provider>
  )
}

/**
 * Reads the Wardic runtime from context.
 *
 * Throws a clear, named error when called outside a `WardicProvider`. Must be
 * called within a Solid owner (component body / `createRoot`).
 *
 * During a server render the runtime is never built (ADR-0021): holding it is fine, but
 * running anything on it fails with DomLive's client-only error. Run on it once the
 * element has mounted (Solid 1: `onMount` / `createEffect`; Solid 2: `onSettled`, an
 * effect's effect half, or `ssrSource: "client"`).
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
 * body / `createRoot`). During a server render it's an inert gate that does nothing
 * (ADR-0021, decision 9).
 */
export function useWardicGate(): FlushGate {
  const value = useContext(WardicContext)
  if (value === undefined) {
    throw new Error("useWardicGate must be used within a <WardicProvider>")
  }
  return value.gate
}

/**
 * Reads whether reduced motion applies now (ADR-0029): the provider's `reducedMotion` and the
 * user's preference. Call the accessor when an animation starts. Throws a clear, named error
 * outside a `WardicProvider`; during a server render it's always `false`. Internal: not exported
 * from the package.
 */
export function useWardicReducedMotion(): () => boolean {
  const value = useContext(WardicContext)
  if (value === undefined) {
    throw new Error("useWardicReducedMotion must be used within a <WardicProvider>")
  }
  return value.reducedMotion
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
  if (value.projection === undefined) {
    throw new Error("useWardicProjection: there is no projection system during a server render (ADR-0021)")
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
 * A failure is logged at Error, `wardic.runScoped: a fiber failed`, with its cause, and
 * reported to the Environment's `ErrorReporter`s (ADR-0030, decision 4); an interruption is
 * neither. That covers drag's track, the hover, press and focus signals, and
 * `useWardicFiber`'s fibers, which nothing else observes. The fiber still fails with it.
 *
 * During a server render it starts nothing and returns a fiber already ended by
 * interruption; while hydrating, the fiber exists at once but its effect starts at mount
 * (the Hydration hold, ADR-0021 decisions 8 and 9).
 *
 * @returns the running fiber, in case the caller wants to await or join it.
 */
export function runScoped<A, E>(
  runtime: WardicRuntime,
  effect: Effect.Effect<A, E, WardicServices>,
): Fiber.Fiber<A, E> {
  // A server render starts nothing (ADR-0021, decision 9): a fiber already ended by
  // interruption, so joining it never hangs, and the runtime stays unbuilt.
  if (isServer) return interrupted<A, E>()
  const reported = effect.pipe(Effect.tapCause((cause) => reportFailure("wardic.runScoped: a fiber failed", cause)))
  if (isHydrating()) {
    // Hydration hold: a real fiber now, whose effect starts at mount (once the latch
    // opens), so nothing it writes can change what the hydration render shows.
    const latch = Latch.makeUnsafe(false)
    const held = runtime.runFork(Effect.andThen(latch.await, reported))
    onMount(() => {
      Effect.runSync(latch.open)
    })
    onCleanup(() => {
      runtime.runFork(Fiber.interrupt(held))
    })
    return held
  }
  const fiber = runtime.runFork(reported)
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
  const runtime = useWardicRuntime()
  // On a server the thunk isn't evaluated: it may read services (ADR-0021, decision 9).
  if (isServer) return interrupted<A, E>()
  return runScoped(runtime, effectThunk())
}

/** A fiber that has already ended by interruption, on no Wardic runtime (1.1 µs). */
const interrupted = <A, E>(): Fiber.Fiber<A, E> => Effect.runFork(Effect.interrupt) as unknown as Fiber.Fiber<A, E>
