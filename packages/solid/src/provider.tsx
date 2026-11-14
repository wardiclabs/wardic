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
import type * as Renderer from "@wardic/core/Renderer"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Bool from "effect/Boolean"
import { constFalse, constUndefined, identity } from "effect/Function"
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
import { type Feature, type FeatureRegistry, type FeatureSection, type FeaturesProp, type ElementFeatures, type InstanceFeatures, joinSections, type Own, ROOT, strictMessage } from "./feature.ts"
import { FeatureSectionProvider, sectionUnder, useLazySection } from "./feature-section.ts"
import * as OwnerScope from "./owner-scope.ts"
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
import { WAITING_ENV_FIX, WAITING_ENV_LINE } from "./messages.ts"
import { warnWithoutSpans } from "./spans-check.ts"
import { isHydrating, isServer } from "./server.ts"
import { reactivity } from "./solid-reactivity.ts"
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
 * What a client provider fails with when its `env` waits as it builds (#746, ADR-0067 *Amendment
 * (#746)*, decision 7): the fix in development, under Solid's `DEV`, and one line in a production
 * build. A server render always gives the fix: Solid 1's server build has no `DEV`, and a client build
 * drops the server's branch.
 */
const waitingEnvMessage = (): string => {
  if (DEV) return WAITING_ENV_FIX
  return WAITING_ENV_LINE
}

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
  /**
   * The Environment Wardic runs in: `DomLive` in a browser, from `@wardic/dom`, with Effect's own Layers merged beside it, and
   * `WardicSpans` for Wardic's spans. Read once, and built at once: a Layer that waits as it builds fails it.
   */
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
   * The nonce your page's Content Security Policy gives inline styles: the `<style>` a server render
   * writes for its entrances carries it, a streamed chunk's too. Motion's `MotionConfig` `nonce`.
   */
  readonly nonce?: string | undefined
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
      onFalse: () => serverAppear(Option.getOrElse(Option.fromUndefinedOr(props.reducedMotion), () => "user" as const), explainerOf(props.appear), props.nonce),
    })
    if (Predicate.isNotUndefined(appear)) useAssets(() => appearStyle(appear))
    const value = serverContext(props.env, WAITING_ENV_FIX, appear, () => untrack(() => props.reducedMotion))
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
    waitingEnvMessage(),
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
  onCleanup(
    whenIdle(() => {
      prepareIdle(value, section)
      // A tracer that reads no Wardic span, development's word (#746).
      if (DEV) warnWithoutSpans(value.runtime)
    }),
  )
  return <WardicContext.Provider value={value}>{props.children}</WardicContext.Provider>
}

/**
 * Each provider's own section (#511): its Features, the first section of its tree. Kept beside its
 * context value, not in a context of its own, so a provider renders one Provider, as before.
 */
// Module state (#460, Q7): each provider's root section, held weakly by its context value.
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
export function useElementFeatures(internal: ElementFeatures): FeatureSection {
  const { brings, instance } = internal
  const complete = internal.complete === true
  const section = useFeatureSection()
  if (DEV && complete && section.strict) throw new Error(strictMessage("wardic.*, wardic.create, createWard, use:wardic", "w.*, w.create, w.createWard, use:w"))
  // A Wardic instance's element (#516): its instance's Features, given at once or loaded, beside its section's.
  if (Predicate.isNotUndefined(instance)) return joinSections(section, useInstanceFeatures(instance))
  if (Predicate.isUndefined(brings)) return section
  const registry = useFeatureRegistry()
  // A Complete element has every Feature, whatever its section has: one section per provider.
  if (complete) return registry.section(brings)
  const own = registry.build(brings)
  return joinSections(section, { services: () => own, pending: constFalse })
}

/**
 * A Wardic instance's Features in this provider (#516), one per instance (`InstanceFeatures.own`): what's
 * given built on first need, each load started the first time it's asked for, on the client. Internal.
 */
export function useInstanceFeatures(instance: InstanceFeatures): Own {
  return fromContext(useContext(WardicContext), "createWardic", (value) =>
    instance.own(value.features, {
      reactivity: reactivity,
      server: isServer,
      report: (cause) => {
        value.runtime.runFork(Report.failure("wardic.createWardic: a lazy load of Features failed", cause))
      },
    }),
  )
}

/**
 * A Wardic instance's Features brought by one of its hooks (#516, Q13): in a provider, what's given is
 * built and its loads start, as at its first element's mount, so its layout hooks bring `layout`.
 * Outside one, nothing. Internal.
 */
export function useInstanceBrought(instance: InstanceFeatures): void {
  if (Predicate.isUndefined(useContext(WardicContext))) return
  const own = useInstanceFeatures(instance)
  untrack(() => own.services())
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
  return Bool.match(css === "", { onTrue: () => undefined, onFalse: () => <style data-wardic-appear nonce={appear.nonce} innerHTML={css} /> })
}

/**
 * The nearest `WardicProvider`'s Effect runtime, for running Effect code on Wardic's services: its
 * clock, frame loop, renderer, probe and the rest. Throws outside a provider. During a server render
 * it isn't built: hold it, but run on it only once the element has mounted.
 *
 * @example
 * const runtime = useWardicRuntime()
 * onMount(() => runtime.runFork(Effect.log("mounted")))
 * @see https://wardic.dev/reference/solid/advanced/runtime
 */
// ADR-0021: a server builds no runtime, and DomLive refuses with its client-only error.
export function useWardicRuntime(): WardicRuntime {
  return fromContext(useContext(WardicContext), "useWardicRuntime", (value) => value.runtime)
}

/**
 * The nearest `WardicProvider`'s flush gate: what a binding registers its elements with, and writes
 * their values into, committed once a frame. For building an element of your own on Wardic's
 * rendering. Throws outside a provider; during a server render it's an inert gate that does nothing.
 *
 * @see https://wardic.dev/reference/solid/advanced/flush-gate
 */
// ADR-0006; inert on a server (ADR-0021, decision 9).
export function useWardicGate(): FlushGate.Shape {
  return fromContext(useContext(WardicContext), "useWardicGate", (value) => value.gate)
}

/**
 * Reads the Environment's Renderer (ADR-0003), read once by the provider: what an element and a
 * presence project and commit through. Throws a clear, named error outside a `WardicProvider`.
 * Internal: not exported from the package.
 */
export function useWardicRenderer(): Renderer.Renderer["Service"] {
  return fromContext(useContext(WardicContext), "useWardicRenderer", (value) => value.renderer)
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
 * Makes a layout change land at once: `start(fn)` runs `fn`, and every layout element goes straight
 * to its new box, a running layout animation ending there too. The change's other animations run as
 * ever. `start()` with no function does the same for a change made later in the task. Motion's
 * `useInstantLayoutTransition`. On a server it runs `fn`.
 *
 * @example
 * const start = createInstantLayoutTransition()
 * start(() => setOrder(sorted()))
 * @see https://wardic.dev/reference/solid/layout/create-instant-layout-transition
 */
// #443: an Instant change of the layout, the projection system's `instant`.
export function createInstantLayoutTransition(): (fn?: () => void) => void {
  return fromContext(useContext(WardicContext), "createInstantLayoutTransition", (value) => instantLayoutOf(() => value.projection))
}

/**
 * Makes a change land at once, with no animation: `start(fn)` runs `fn`, and its layout change and
 * every animation that starts until two frames after the call land where they're going. A later call
 * extends it, and `start.end()` ends it now. For a change that shouldn't animate: a reset, a jump to
 * a route. Motion's `useInstantTransition`.
 *
 * @example
 * const start = createInstantTransition()
 * <button onClick={() => start(() => setOpen(all))}>Open all</button>
 * @see https://wardic.dev/reference/solid/layout/create-instant-transition
 */
// #443: an Instant change, each animation it covers a Skipped animation (#468); `start.end()` is
// Motion's `disableInstantTransitions`.
export function createInstantTransition(): InstantTransition {
  return fromContext(useContext(WardicContext), "createInstantTransition", (value) => instantTransitionOf(() => value.projection, () => value.instant))
}

/**
 * Starts layout animations afresh: `reset()` ends every running layout animation where the layout puts
 * its element, lets go of every leaving `layoutId` element, and has the next measure take every box as
 * it is, animating none. For a change that replaces the page wholesale. Motion's `useResetProjection`.
 * On a server it does nothing.
 *
 * @example
 * const reset = createResetProjection()
 * const openWorkspace = (id: string) => {
 *   reset()
 *   setWorkspace(id)
 * }
 * @see https://wardic.dev/reference/solid/layout/create-reset-projection
 */
// #443: a Projection reset, the projection system's `reset`: leavers and Switch seeds dropped.
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
 * Animates a layout change you make: `animateLayout(fn)` runs `fn`, and every layout element animates
 * from where it was at the call to where the change puts it. For a change nothing else sees, such as a
 * keyed `<For>` reordered or a plain element's class changed. `fn` runs at once, and `animateLayout`
 * returns what it returns; `{ onSettled }` is called once the animations it started have ended. Only
 * what `fn` changes synchronously animates. On a server it just runs `fn`. Throws outside a
 * `WardicProvider`.
 *
 * @example
 * const animateLayout = useAnimateLayout()
 * const shuffle = () => animateLayout(() => setItems(shuffled(items())))
 * @see https://wardic.dev/reference/solid/layout/use-animate-layout
 */
// #4, ADR-0038: a Declared layout change, from Measurements taken at the call; also for a change made
// after an untriggered one left a Measurement out of date. Calls in one task share the first call's
// Measurements. A promise `fn` returns isn't awaited, and logs a warning.
export function useAnimateLayout(): AnimateLayout {
  return animateLayoutOf(useContext(WardicContext))
}

/**
 * Runs `effect` on `runtime`, and interrupts it as the current owner is cleaned up, its Scope closed
 * with it. Returns its fiber. A failure is logged and reported to the Environment's error reporters;
 * an interruption is neither. On a server it starts nothing, and while hydrating it starts at mount.
 * Call it within a Solid owner.
 *
 * @example
 * runScoped(runtime, Stream.runForEach(ticks, (t) => Effect.sync(() => setTick(t))))
 * @see https://wardic.dev/reference/solid/advanced/runtime
 */
// ADR-0006: the per-element fiber lifecycle; a failure is `wardic.runScoped: a fiber failed`
// (ADR-0030, decision 4); the Hydration hold (ADR-0021 decisions 8 and 9).
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
      latch.openUnsafe()
    })
    onCleanup(() => held.interruptUnsafe())
    return held
  }
  const fiber = runtime.runFork(run)
  // Interrupted where the cleanup runs, nothing waiting on its end, as `runCallback`'s interruptor
  // does: a forked `Fiber.interrupt` was a fiber of its own for each (#618, L2).
  onCleanup(() => fiber.interruptUnsafe())
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
  const scope = OwnerScope.open(runtime)
  // Closed with the owner, set before the watch starts, so one that throws as it subscribes leaves no
  // listener behind (#618, decision 5).
  onCleanup(() => OwnerScope.close(runtime, scope, "wardic.runWatch: a finalizer failed"))
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("wardic.runWatch: a gesture handler failed", cause))
  }
  const start = (): void => {
    runtime.runSync(watch(onDefect).pipe(Scope.provide(scope)))
  }
  Bool.match(isHydrating(), { onTrue: () => onMount(start), onFalse: start })
}

/**
 * Runs the Effect `effectThunk` makes on the provider's runtime, as `runScoped` does, until the
 * current owner is cleaned up. The thunk is called once; not on a server. Returns its fiber.
 *
 * @example
 * useWardicFiber(() => Stream.runForEach(ticks, (t) => Effect.sync(() => setTick(t))))
 * @see https://wardic.dev/reference/solid/advanced/runtime
 */
export function useWardicFiber<A, E>(
  effectThunk: () => Effect.Effect<A, E, WardicServices>,
): Fiber.Fiber<A, E> {
  const runtime = useWardicRuntime()
  // On a server the thunk isn't evaluated: it may read services (ADR-0021, decision 9).
  if (isServer) return interrupted<A, E>()
  return runScoped(runtime, effectThunk())
}
