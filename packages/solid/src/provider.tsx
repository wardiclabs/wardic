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
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Bool from "effect/Boolean"
import { constUndefined, identity } from "effect/Function"
import * as Latch from "effect/Latch"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { batch, createContext, DEV, onCleanup, onMount, untrack, useContext } from "solid-js"
import type { JSX } from "solid-js"
import { useAssets } from "solid-js/web"
import * as Appear from "@wardic/dom/Appear"
import * as Report from "@wardic/dom/Report"
import type * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { explainerOf, type ServerAppear, serverAppear } from "./appear.ts"
import * as Context from "effect/Context"
import { type Feature, type FeatureRegistry, type FeatureSection, type FeaturesProp, ROOT, strictMessage } from "./feature.ts"
import { FeatureSectionProvider, sectionUnder, useLazySection } from "./feature-section.ts"
import {
  type AnimateLayout,
  animateLayoutOf,
  clientContext,
  fromContext,
  interrupted,
  prepareIdle,
  reducedMotionSettingWith,
  reducedMotionWith,
  reported,
  serverContext,
  type WardicContextValue,
  type WardicEnv,
  type WardicRuntime,
  type WardicServices,
  whenIdle,
} from "./runtime.ts"
import { isHydrating, isServer } from "./server.ts"
import { useWardicConfig } from "./wardic-config.tsx"
import { skipAnimationsOf } from "./wardic-config-value.ts"
import { instantLayoutOf, type InstantTransition, instantTransitionOf, resetOf } from "./instant.ts"
import type { WardicScaleCorrector } from "./config.ts"

/**
 * Context carrying the single runtime + flush gate down the tree. Defaults to
 * `undefined` so {@link useWardicRuntime} / {@link useWardicGate} can detect
 * (and clearly reject) reads made outside a `WardicProvider`.
 */
const WardicContext = createContext<WardicContextValue | undefined>(undefined)

/**
 * Puts Wardic in your app: every Wardic element sits under one. Give it the Environment, `DomLive` in
 * a browser, and the Features your elements use.
 *
 * @example
 * <WardicProvider env={DomLive} features={[domAnimation]}>
 *   <App />
 * </WardicProvider>
 * @see https://wardic.dev/reference/solid/provider/wardic-provider
 */
// One Effect runtime per provider (ADR-0006), made once from `env` and disposed on unmount
// (fire-and-forget). Built on first need (#51, ADR-0021 Amendment (#51)): the runtime on its first run,
// the gate, projection and reduced-motion inputs the first time an element or hook under it reads one,
// so a provider with nothing under it builds nothing, and a failing `env` fails at the first element.
// Client-only (ADR-0021): a server render holds an unbuilt runtime, an inert gate and no projection,
// and running anything on it fails with DomLive's client-only error; run Effects after mount (Solid 1:
// onMount or createEffect). reducedMotion: ADR-0029, read as each animation starts, a WardicConfig's
// over it (#434). appear: ADR-0044, read on the server once; "explain" (#585). scaleCorrectors: #443,
// this provider's alone, one keyed borderRadius/boxShadow replacing the built-in; ignored on a server.
// features/strict: #511, ADR-0067, read once.
export function WardicProvider(props: {
  /** The Environment Wardic runs in: `DomLive` in a browser, from `@wardic/dom`. Read once. */
  readonly env: WardicEnv
  /**
   * How animations honour the visitor's reduced-motion setting: `"user"` follows it (the default),
   * `"always"` reduces motion, `"never"` doesn't. Under it, what moves or resizes jumps to where it's
   * going, and the rest, such as opacity, still animates. A `WardicConfig` sets it for a subtree.
   */
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /**
   * On a server-rendered page, entrances play from the first paint, before the JavaScript has loaded
   * (the default, `true`). `false` makes them wait for the JavaScript; `"explain"` plays them, and
   * logs on the server why each element that can't play waits.
   */
  readonly appear?: boolean | "explain" | undefined
  /**
   * Your own corrections of a value a layout animation's scale would distort, by the key each corrects:
   * Motion's `addScaleCorrector`, given here. Read once.
   */
  readonly scaleCorrectors?: Readonly<Record<string, WardicScaleCorrector>> | undefined
  /**
   * The Features every `w.*` element under it has: at once (`[domAnimation]`), or loaded with a
   * function (`() => import("./features").then((m) => m.drag)`). Read once.
   */
  readonly features?: FeaturesProp | undefined
  /** In development, a `wardic.*` element under it throws, so every element ships only its Features. */
  readonly strict?: boolean | undefined
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
      onFalse: () => serverAppear(Option.getOrElse(Option.fromUndefinedOr(props.reducedMotion), () => "user" as const), explainerOf(props.appear)),
    })
    if (Predicate.isNotUndefined(appear)) useAssets(() => appearStyle(appear))
    const value = serverContext(props.env, appear, () => untrack(() => props.reducedMotion))
    onCleanup(() => void value.features.dispose())
    sections.set(value, sectionOf(value, ROOT, props))
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
  const value = clientContext(
    props.env,
    batch,
    () => untrack(() => props.reducedMotion),
    // Tracked, for `createReducedMotionConfig` (#584).
    () => props.reducedMotion,
    untrack(() => props.scaleCorrectors),
  )
  // Its Features end first, then the runtime they stand on (#511).
  onCleanup(() => void value.features.dispose())
  const section = sectionOf(value, ROOT, props)
  sections.set(value, section)
  // Built at the browser's idle time, after this render (#535): what a first element would build, so an
  // element mounted after pays none of it. One mounted before then builds it itself, as before. Asked
  // for here, with no computation of the provider's own, so a hydration's owners are the server's.
  onCleanup(whenIdle(() => prepareIdle(value, section)))
  return <WardicContext.Provider value={value}>{props.children}</WardicContext.Provider>
}

/**
 * Each provider's own section (#511): its Features, the first section of its tree. Kept beside its
 * context value, not in a context of its own, so a provider renders one Provider, as before.
 */
const sections = new WeakMap<WardicContextValue, FeatureSection>()

/**
 * The section an element is in (#511): the nearest `LazyWardic`'s, else its provider's own; outside a
 * provider, none. Internal.
 */
export function useFeatureSection(): FeatureSection {
  return UndefinedOr.match(useLazySection(), {
    onDefined: identity,
    onUndefined: () => UndefinedOr.match(useContext(WardicContext), { onUndefined: () => ROOT, onDefined: (value) => UndefinedOr.getOrThrow(sections.get(value)) }),
  })
}

/**
 * The section `props` make under `parent` (#511), on `value`'s registry: a failed lazy load reported
 * as a fiber's failure is (ADR-0030, decision 4).
 */
const sectionOf = (
  value: WardicContextValue,
  parent: FeatureSection,
  props: { readonly features?: FeaturesProp | undefined; readonly strict?: boolean | undefined },
): FeatureSection =>
  sectionUnder(parent, value.features, untrack(() => props.features), untrack(() => props.strict) === true, (cause) => {
    value.runtime.runFork(Report.failure("wardic.features: a lazy load of Features failed", cause))
  })

/**
 * Gives the `w.*` elements in its section more Features, beside their provider's: at once
 * (`features={[drag]}`), or loaded with a function, which runs as the section renders, so a page loads
 * a Feature only when it needs it. Motion's `LazyMotion`.
 *
 * @example
 * <LazyWardic features={() => import("./drag-feature").then((m) => m.drag)}>
 *   <w.div drag />
 * </LazyWardic>
 * @see https://wardic.dev/reference/solid/provider/lazy-wardic
 */
// #511, ADR-0067; Motion's LazyMotion. Given at once, built the first time an element below asks;
// loaded lazily, the load starts as it renders, on the client, its elements animating values at once and
// each Feature taking effect as it arrives, nothing replayed: a gesture or a drag (#551) starts then, and
// a layout node is made then (#582). A failed load is reported once. A server render loads nothing.
export function LazyWardic(props: {
  /** Its Features: one, a list, or a function that loads them. Read once. */
  readonly features: FeaturesProp
  /** In development, a `wardic.*` element under it throws. Read once. */
  readonly strict?: boolean | undefined
  readonly children?: JSX.Element
}): JSX.Element {
  const value = useContext(WardicContext)
  const section = fromContext(value, "LazyWardic", (v) => sectionOf(v, useFeatureSection(), props))
  return <FeatureSectionProvider value={section}>{props.children}</FeatureSectionProvider>
}

/**
 * The Features an element has (#511): its section's, and those it brings, a Complete element's every
 * one (`brings`), built at once. A Complete element under a `strict` section is an error in
 * development. Internal.
 */
export function useElementFeatures(brings: ReadonlyArray<Feature> | undefined, complete: boolean): FeatureSection {
  const section = useFeatureSection()
  if (DEV && complete && section.strict) throw new Error(strictMessage("wardic.*, wardic.create, createWard, use:wardic", "w.*, w.create, w.createWard, use:w"))
  if (Predicate.isUndefined(brings)) return section
  const registry = useFeatureRegistry()
  // A Complete element has every Feature, whatever its section has: one section per provider.
  if (complete) return registry.section(brings)
  const own = registry.build(brings)
  return { services: () => Context.merge(section.services(), own), pending: section.pending, strict: section.strict }
}

/** The provider's Features (#511). Internal. */
export function useFeatureRegistry(): FeatureRegistry {
  return fromContext(useContext(WardicContext), "useFeatureRegistry", (value) => value.features)
}

/**
 * The services of `features`, which a hook or component brings (#511, decision 12) whatever its
 * section has: built the first time they're read, on the client. `features` is a list the caller keeps,
 * so its provider joins it once. Internal.
 */
export function useBrought(features: ReadonlyArray<Feature>): () => Context.Context<never> {
  const registry = useFeatureRegistry()
  return () => registry.build(features)
}

/**
 * A server render's Appear animations (#48, ADR-0044), or `undefined`: on the client, outside a
 * provider, or with `appear={false}`. Internal.
 */
export function useWardicAppear(): ServerAppear | undefined {
  return UndefinedOr.match(useContext(WardicContext), { onUndefined: constUndefined, onDefined: (value) => value.appear })
}

/** The head's `<style>` for a render's Appear animations, or nothing when no element plays one. */
const appearStyle = (appear: ServerAppear): JSX.Element => {
  const css = appear.css()
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
 * Reads whether reduced motion applies now (ADR-0029): the nearest `WardicConfig`'s `reducedMotion`
 * (#434), else the provider's, and the user's preference. Call the accessor when an animation starts. Throws a clear, named error
 * outside a `WardicProvider`; during a server render it's always `false`. Internal: not exported
 * from the package.
 */
export function useWardicReducedMotion(): () => boolean {
  const config = useWardicConfig()
  return fromContext(useContext(WardicContext), "useWardicReducedMotion", (value) => reducedMotionWith(value, config))
}

/**
 * Whether the elements here skip their animations now (#468): the nearest `WardicConfig`'s
 * `skipAnimations`, or the provider's Instant change while one runs (#443). Read when each starts.
 * Internal.
 */
export function useWardicSkipAnimations(): () => boolean {
  const config = skipAnimationsOf(useWardicConfig())
  const value = useContext(WardicContext)
  if (Predicate.isUndefined(value)) return config
  const instant = value.instant
  return () => Bool.or(instant.active(), config())
}

/**
 * An **Instant change** of the layout (#443, Motion's `useInstantLayoutTransition`): `start(fn)` runs
 * `fn`, and the layout change it makes lands at once, every element on its new box, a running layout
 * animation ended too; the change's other animations run as ever. On a server it runs `fn`.
 *
 * ```tsx
 * const start = createInstantLayoutTransition()
 * start(() => setOrder(sorted()))
 * ```
 */
export function createInstantLayoutTransition(): (fn?: () => void) => void {
  return fromContext(useContext(WardicContext), "createInstantLayoutTransition", (value) => instantLayoutOf(() => value.projection))
}

/**
 * An **Instant change** (#443, Motion's `useInstantTransition`): `start(fn)` runs `fn`, and what it
 * changes lands at once, its layout and every animation that starts until two frames after the call
 * (a **Skipped animation**, #468). A later call extends it, and `start.end()` ends it now (Motion's
 * `disableInstantTransitions`). For a change that shouldn't animate: a reset, a jump to a route.
 *
 * ```tsx
 * const start = createInstantTransition()
 * <button onClick={() => start(() => setOpen(all))}>Open all</button>
 * ```
 */
export function createInstantTransition(): InstantTransition {
  return fromContext(useContext(WardicContext), "createInstantTransition", (value) => instantTransitionOf(() => value.projection, () => value.instant))
}

/**
 * A **Projection reset** (#443, Motion's `useResetProjection`): `reset()` ends every layout animation
 * on its element's slot, drops every leaving `layoutId` twin and Switch seed, and has the next layout
 * measure take every box afresh, animating none. For a change that replaces the page wholesale. On a
 * server it does nothing.
 */
export function createResetProjection(): () => void {
  return fromContext(useContext(WardicContext), "createResetProjection", (value) => resetOf(() => value.projection))
}

/**
 * The reduced-motion setting that applies here (#443): the nearest `WardicConfig`'s `reducedMotion`,
 * else the provider's, else `"user"`, each tracked (#584). Internal.
 */
export function useWardicReducedMotionSetting(): () => ReducedMotion.Config {
  const config = useWardicConfig()
  return fromContext(useContext(WardicContext), "useWardicReducedMotionSetting", (value) => reducedMotionSettingWith(value, config))
}

/**
 * `read` of the nearest provider's context value, named `name` in the error outside one: for a hook in
 * a module of its own (#548), such as `useWardicProjection`, which brings `layout`.
 */
export const fromWardicContext = <A,>(name: string, read: (value: WardicContextValue) => A): A => fromContext(useContext(WardicContext), name, read)

/**
 * The provider's projection system once its `layout` Feature is built (#511), read as it's needed;
 * `undefined` until then, and during a server render. For what brings no `layout` and works with the
 * layout elements that are there: an element registering its values, a presence. Internal.
 */
export function useBuiltProjection(): () => ProjectionSystem.Shape | undefined {
  return fromContext(useContext(WardicContext), "useBuiltProjection", (value) => () => value.projection)
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
  watch: (onDefect: InputFeed.OnDefect) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
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
