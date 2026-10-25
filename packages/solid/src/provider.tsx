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
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as Recognizer from "@wardic/core/Recognizer"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as Latch from "effect/Latch"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { batch, createContext, onCleanup, onMount, untrack, useContext } from "solid-js"
import type { JSX } from "solid-js"
import { useAssets } from "solid-js/web"
import * as Appear from "@wardic/dom/Appear"
import * as Report from "@wardic/dom/Report"
import type * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { type ServerAppear, serverAppear } from "./appear.ts"
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
} from "./runtime.ts"
import { isHydrating, isServer } from "./server.ts"

/**
 * Context carrying the single runtime + flush gate down the tree. Defaults to
 * `undefined` so {@link useWardicRuntime} / {@link useWardicGate} can detect
 * (and clearly reject) reads made outside a `WardicProvider`.
 */
const WardicContext = createContext<WardicContextValue | undefined>(undefined)

/**
 * Provides a single Effect runtime (built once from `env`) to its subtree.
 *
 * Makes `ManagedRuntime.make(env)` exactly once for the lifetime of the
 * component, exposes it through context, and disposes it on unmount
 * (fire-and-forget — `dispose` returns a `Promise`). `env` is required; pass
 * `DomLive` (browser) or `TestLive` (tests).
 *
 * It builds on first need (#51, ADR-0021 *Amendment (#51)*): the runtime on its first run, and
 * the flush gate, the projection system and the reduced-motion inputs the first time a Wardic
 * element or hook under it reads one, during that element's render. So a provider with nothing
 * from Wardic under it builds nothing, and an `env` that fails to build fails there, at the
 * first element.
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
 *
 * `appear` (#48, ADR-0044), default `true`: a server render starts each element's mount animation
 * in CSS from first paint (an **Appear animation**), sampled from Wardic's own machines into a
 * `<style>` in the page's head, and the client takes it over at mount (the **Handoff**). With JS
 * off it plays to its end. `appear={false}` renders every element at its Starting style until mount,
 * as before; an element's own `appear={false}` does that for it alone. Read on the server, once.
 */
export function WardicProvider(props: {
  readonly env: WardicEnv
  readonly reducedMotion?: ReducedMotion.Config | undefined
  readonly appear?: boolean | undefined
  readonly children?: JSX.Element
}): JSX.Element {
  if (isServer) {
    // A server render builds no runtime (ADR-0021, decisions 1 and 3), and the same JSX as the
    // client, so the hydration keys match. Its runtime is unbuilt, but an Environment that builds
    // on a server (TestLive) could be built by user code: disposed with the render, as on unmount.
    // The render's Appear animations (#48, ADR-0044): each element takes a slot as it renders,
    // and once the render is done the head's `<style>` gets every rule and timing (`useAssets`,
    // injected before `</head>`). A render with no `</head>` drops it, and its elements keep their
    // Starting style, as they would without it.
    const appear = Bool.match(props.appear === false, {
      onTrue: constUndefined,
      onFalse: () => serverAppear(Option.getOrElse(Option.fromUndefinedOr(props.reducedMotion), () => "user" as const)),
    })
    if (Predicate.isNotUndefined(appear)) useAssets(() => appearStyle(appear))
    const value = serverContext(props.env, appear)
    onCleanup(() => void value.runtime.dispose())
    return <WardicContext.Provider value={value}>{props.children}</WardicContext.Provider>
  }

  // A streamed page's late chunks bring their own Appear rules (#245): moved into the head before
  // the chunks hydrate, those already here now (this provider hydrates before its subtree), and
  // each later one as it lands, until the stream ends.
  if (isHydrating()) Appear.adoptChunks(document)

  // Made ONCE: props.env is read a single time at construction, and the runtime built over it
  // runs a frame's Starting-style switches through Solid's `batch` (ADR-0034). The rest builds on
  // first need (#51). Disposing the runtime closes its Scope, which ends the projection system,
  // then the gate (#132); dispose() returns a Promise, fire-and-forget on unmount.
  const value = clientContext(props.env, batch, () => untrack(() => props.reducedMotion))
  onCleanup(() => void value.runtime.dispose())
  return <WardicContext.Provider value={value}>{props.children}</WardicContext.Provider>
}

/**
 * A server render's Appear animations (#48, ADR-0044), or `undefined`: on the client, outside a
 * provider, or with `appear={false}`. Internal.
 */
export function useWardicAppear(): ServerAppear | undefined {
  return UndefinedOr.match(useContext(WardicContext), { onUndefined: constUndefined, onDefined: (value) => value.appear })
}

/**
 * The head's `<style>` for a render's Appear animations, or nothing when no element plays one;
 * why each element that doesn't play doesn't, as a debug log (`wardic.hydration`).
 */
const appearStyle = (appear: ServerAppear): JSX.Element => {
  const css = appear.css()
  const reasons = appear.reasons()
  if (reasons.length > 0) {
    Effect.runSync(Effect.logDebug("wardic.hydration: elements keep their Starting style until mount").pipe(Effect.annotateLogs({ reasons })))
  }
  return Bool.match(css === "", { onTrue: () => undefined, onFalse: () => <style data-wardic-appear innerHTML={css} /> })
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
  return fromContext(useContext(WardicContext), "useWardicRuntime", (value) => value.runtime)
}

/**
 * Reads the provider-owned flush gate from context (ADR-0006).
 *
 * Throws a clear, named error when called outside a `WardicProvider` (mirrors
 * {@link useWardicRuntime}). Must be called within a Solid owner (component
 * body / `createRoot`). During a server render it's an inert gate that does nothing
 * (ADR-0021, decision 9).
 */
export function useWardicGate(): FlushGate.Shape {
  return fromContext(useContext(WardicContext), "useWardicGate", (value) => value.gate)
}

/**
 * Reads the Environment's Positional keys (ADR-0036): which keys reduced motion Snaps. Throws a
 * clear, named error outside a `WardicProvider`; during a server render, the transforms only.
 * Internal: not exported from the package.
 */
export function useWardicPositionalKeys(): ReducedMotion.PositionalKeys["Service"] {
  return fromContext(useContext(WardicContext), "useWardicPositionalKeys", (value) => value.positionalKeys)
}

/**
 * Reads the Environment's Default transition (ADR-0051): what a key with no transition of its own
 * runs on. Throws a clear, named error outside a `WardicProvider`. Internal: not exported from the
 * package.
 */
export function useWardicDefaultTransition(): DefaultTransition.DefaultTransition["Service"] {
  return fromContext(useContext(WardicContext), "useWardicDefaultTransition", (value) => value.defaultTransition)
}

/**
 * Reads whether reduced motion applies now (ADR-0029): the provider's `reducedMotion` and the
 * user's preference. Call the accessor when an animation starts. Throws a clear, named error
 * outside a `WardicProvider`; during a server render it's always `false`. Internal: not exported
 * from the package.
 */
export function useWardicReducedMotion(): () => boolean {
  return fromContext(useContext(WardicContext), "useWardicReducedMotion", (value) => value.reducedMotion)
}

/**
 * Reads the provider-owned projection system (ADR-0009 — the box-based layout
 * engine). Throws a clear, named error outside a `WardicProvider`. Must be called
 * within a Solid owner.
 */
export function useWardicProjection(): ProjectionSystem.Shape {
  return projectionOf(useContext(WardicContext))
}

/**
 * The provider's `animateLayout` (#4, ADR-0038): run `fn`, and animate the layout change it makes
 * from where every layout element is at the call, a **Declared layout change**. It's for a change no
 * trigger sees, such as a keyed `<For>` reordered or a plain element's class, and for one made after
 * an untriggered change left a Measurement out of date:
 *
 * ```tsx
 * const animateLayout = useAnimateLayout()
 * const shuffle = () => animateLayout(() => setItems(shuffled(items())))
 * ```
 *
 * `fn` runs at once, so the change is there when the call returns, and its error throws to the
 * caller. Calls in one task share the first call's Measurements. Only the synchronous part animates:
 * a promise `fn` returns isn't awaited, and logs a warning. During a server render it just runs `fn`.
 * Throws a clear, named error outside a `WardicProvider`. Must be called within a Solid owner.
 */
export function useAnimateLayout(): AnimateLayout {
  return animateLayoutOf(useContext(WardicContext))
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
  const run = reported(effect)
  if (isHydrating()) {
    // Hydration hold: a real fiber now, whose effect starts at mount (once the latch
    // opens), so nothing it writes can change what the hydration render shows.
    const latch = Latch.makeUnsafe(false)
    const held = runtime.runFork(Effect.andThen(latch.await, run))
    onMount(() => {
      Effect.runSync(latch.open)
    })
    onCleanup(() => {
      runtime.runFork(Fiber.interrupt(held))
    })
    return held
  }
  const fiber = runtime.runFork(run)
  onCleanup(() => {
    // Interrupting is itself an Effect; fork it on the runtime so it runs
    // without blocking the synchronous cleanup pass.
    runtime.runFork(Fiber.interrupt(fiber))
  })
  return fiber
}

/**
 * Runs a gesture watch (#318, ADR-0055) in a Scope of its own, closed when the current owner is
 * disposed: subscribed at once, with no fiber. A throw from its handler is logged at Error and
 * reported to the Environment's `ErrorReporter`s, as a fiber's failure is (ADR-0030, decision 4),
 * and the watch goes on. A server render starts nothing; while hydrating it starts at mount (the
 * Hydration hold, ADR-0021 decisions 8 and 9). Must be called within a Solid owner.
 */
export function runWatch(
  runtime: WardicRuntime,
  watch: (onDefect: Recognizer.OnDefect) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
): void {
  if (isServer) return
  const scope = Scope.makeUnsafe()
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("wardic.runWatch: a gesture handler failed", cause))
  }
  const start = (): void => {
    runtime.runSync(watch(onDefect).pipe(Scope.provide(scope)))
  }
  Bool.match(isHydrating(), { onTrue: () => onMount(start), onFalse: start })
  onCleanup(() => {
    runtime.runSync(Scope.close(scope, Exit.void))
  })
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
