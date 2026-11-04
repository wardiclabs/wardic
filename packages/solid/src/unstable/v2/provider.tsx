/**
 * `WardicProvider` for Solid 2 (`@wardic/solid/unstable/v2`, #209): one Effect runtime for a
 * subtree, as the Solid 1 binding's provider (`../../provider.tsx`), over the same runtime and
 * services (`../../runtime.ts`). What Solid 2 changes:
 *
 * - **No `batch`.** Solid 2 batches every update on a microtask, and a read lags its setter until
 *   then. The flush gate needs a frame's Starting-style switches to have reached the elements
 *   before it commits (ADR-0034), so it gets `flush(apply)`: the switches set their signals in a
 *   synchronous flush scope, drained as it returns, with no microtask scheduled for them (#257
 *   item 12). The gate runs them from its frame flush, outside any owner, where Solid 2 lets a
 *   signal be written.
 * - **A context value is its own provider** (`<WardicContext value={…}>`).
 * - **`onSettled`** opens the Hydration hold where Solid 1 had `onMount` (`onSettledClientOnly`: a
 *   server starts nothing, so it takes no hydration id).
 * - **Appear animations' `<style>` goes through the head registry** (`useHead`, #209 PR 4a) where
 *   Solid 1 had `useAssets`. Registered on the server only, in its function form, which the server
 *   reads when it writes the head, once the shell has rendered: every element is entered then, with
 *   its timing. A client never registers it, and leaves the server's in the head. A late chunk's
 *   elements register their own, which streams with the chunk as a head patch (`ward.tsx`).
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constUndefined, identity } from "effect/Function"
import * as Latch from "effect/Latch"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { type HeadTag, isServer, type JSX, useHead } from "@solidjs/web"
import { createContext, DEV, flush, isHydrating, onCleanup, untrack, useContext } from "solid-js"
import * as Context from "effect/Context"
import * as Report from "@wardic/dom/Report"
import { type Feature, type FeatureRegistry, type FeatureSection, type FeaturesProp, ROOT, strictMessage } from "../../feature.ts"
import { FeatureSectionContext, sectionUnder, useLazySection } from "./feature-section.ts"
import { explainerOf, type ServerAppear, serverAppear } from "../../appear.ts"
import {
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
} from "../../runtime.ts"
import { onSettledClientOnly } from "./solid-reactivity.ts"
import { useWardicConfig } from "./wardic-config.tsx"
import { skipAnimationsOf } from "../../wardic-config-value.ts"
import { instantLayoutOf, type InstantTransition, instantTransitionOf, resetOf } from "../../instant.ts"
import type { WardicScaleCorrector } from "../../config.ts"

/** A frame's Starting-style switches, applied and drained before the gate commits (ADR-0034): Solid 2's `batch`. */
const applyAndFlush = (apply: () => void): void => {
  flush(apply)
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
 * render (ADR-0021). `reducedMotion` (ADR-0029) is read when each animation starts; a `WardicConfig`
 * sets it for the elements below it (#434).
 */
export function WardicProvider(props: {
  readonly env: WardicEnv
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /**
   * Appear animations (#48, ADR-0044), default `true`: a server render starts each element's mount
   * animation in CSS from first paint, and the client takes it over at mount (the **Handoff**).
   * `false` renders every element at its Starting style until mount. `"explain"` (#585) plays them as
   * `true` does, and the server says, at Warning, why each element that doesn't play waits for the
   * JavaScript: its tag, the keys it animates, and the reason. Read on the server, once.
   */
  readonly appear?: boolean | "explain" | undefined
  /**
   * The app's scale correctors (#443, Motion's `addScaleCorrector`, given here), by the value key each
   * corrects, in Motion's form: this provider's alone, read once. One keyed `borderRadius` or
   * `boxShadow` replaces the built-in one. Ignored on a server.
   */
  readonly scaleCorrectors?: Readonly<Record<string, WardicScaleCorrector>> | undefined
  /**
   * The **Features** every Slim element (`w.*`) under it has (#511, ADR-0067), as a `LazyWardic`'s
   * are for its section: given at once (`features={[colors]}`), or loaded lazily
   * (`features={() => import("./features.ts").then((m) => m.colors)}`), taking effect as they arrive.
   * A Complete element (`wardic.*`, `ward()`) has every Feature whatever it's given. Read once.
   */
  readonly features?: FeaturesProp | undefined
  /** A Complete element under it is an error in development (#511). Read once. */
  readonly strict?: boolean | undefined
  readonly children?: JSX.Element
}): JSX.Element {
  const value = Bool.match(isServer, {
    onTrue: () => serverContext(props.env, serverAppearOf(props.appear, props.reducedMotion), () => untrack(() => props.reducedMotion)),
    onFalse: () => clientContext(props.env, applyAndFlush, () => untrack(() => props.reducedMotion), untrack(() => props.scaleCorrectors)),
  })
  // Disposing the runtime closes its Scope: the projection system, then the gate (#132). Its
  // disposal rejects first, ending every `animateLayout` still waiting: their flights won't end (#257).
  let abort = constUndefined as (reason: DOMException) => void
  const disposed = new Promise<never>((_, reject) => {
    abort = reject
  })
  // Each waiting call races it and handles it; with none, it's handled here.
  disposed.catch(constUndefined)
  disposals.set(value, disposed)
  onCleanup(() => {
    abort(new DOMException("The WardicProvider was disposed before its layout animations ended.", "AbortError"))
    // Its Features end first, then the runtime they stand on (#511).
    void value.features.dispose()
  })
  const section = sectionOf(value, ROOT, props)
  sections.set(value, section)
  // Built at the browser's idle time, after this render (#535): what a first element would build, so an
  // element mounted after pays none of it. One mounted before then builds it itself, as before. Asked
  // for here, with no computation of the provider's own (an `onSettled`'s would shift a hydration's
  // owners from the server's), and on the client alone.
  if (Bool.not(isServer)) onCleanup(whenIdle(() => prepareIdle(value, section)))
  return <WardicContext value={value}>{props.children}</WardicContext>
}

/**
 * Each provider's own section (#511): its Features, the first section of its tree. Kept beside its
 * context value, not in a context of its own, so a provider renders one context, as before.
 */
const sections = new WeakMap<WardicContextValue, FeatureSection>()

/**
 * The section an element is in (#511): the nearest `LazyWardic`'s, else its provider's own; outside a
 * provider, none. Internal.
 */
export function useFeatureSection(): FeatureSection {
  return UndefinedOr.match(useLazySection(), {
    onDefined: identity,
    onUndefined: () => UndefinedOr.match(contextValue(), { onUndefined: () => ROOT, onDefined: (value) => UndefinedOr.getOrThrow(sections.get(value)) }),
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
 * **`LazyWardic`** (#511, ADR-0067; Motion's `LazyMotion`): the **Features** the Slim elements
 * (`w.*`, `w.ward()`) below it have, beside their provider's and every `LazyWardic`'s between them,
 * as the Solid 1 binding's. Given at once, they're built the first time an element below asks;
 * loaded lazily, the load starts as it renders, on the client, and each Feature takes effect as it
 * arrives, from then on: a gesture or a drag (#551) starts then, while `layout` reaches only the
 * elements that mount after it. A failed load is reported once. A server render loads nothing. `strict`
 * makes a Complete element below it an error in development. Both props are read once.
 */
export function LazyWardic(props: { readonly features: FeaturesProp; readonly strict?: boolean | undefined; readonly children?: JSX.Element }): JSX.Element {
  const section = fromContext(contextValue(), "LazyWardic", (value) => sectionOf(value, useFeatureSection(), props))
  return <FeatureSectionContext value={section}>{props.children}</FeatureSectionContext>
}

/**
 * The Features an element has (#511): its section's, and those it brings, a Complete element's every
 * one (`brings`), built at once. A Complete element under a `strict` section is an error in
 * development. Internal.
 */
export function useElementFeatures(brings: ReadonlyArray<Feature> | undefined, complete: boolean): FeatureSection {
  const section = useFeatureSection()
  if (DEV && complete && section.strict) throw new Error(strictMessage("wardic.*, wardic.create, ward()", "w.*, w.create, w.ward()"))
  if (Predicate.isUndefined(brings)) return section
  const registry = useFeatureRegistry()
  // A Complete element has every Feature, whatever its section has: one section per provider.
  if (complete) return registry.section(brings)
  const own = registry.build(brings)
  return { services: () => Context.merge(section.services(), own), pending: section.pending, strict: section.strict }
}

/** The provider's Features (#511). Internal. */
export function useFeatureRegistry(): FeatureRegistry {
  return fromContext(contextValue(), "useFeatureRegistry", (value) => value.features)
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

/** Each client provider's disposal (#257): a promise that rejects with an `AbortError` then. */
const disposals = new WeakMap<WardicContextValue, Promise<never>>()

/**
 * A server render's Appear animations (#48, ADR-0044), with the head's `<style>` registered for
 * them, or `undefined` with `appear={false}`. Each element takes a slot as it renders; the head
 * gets every rule and timing once the shell has rendered.
 */
const serverAppearOf = (appear: boolean | "explain" | undefined, reducedMotion: ReducedMotion.Config | undefined): ServerAppear | undefined => {
  if (appear === false) return undefined
  const state = serverAppear(UndefinedOr.match(reducedMotion, { onUndefined: () => "user" as const, onDefined: identity }), explainerOf(appear))
  useHead(appearStyle(() => state.css()))
  return state
}

/**
 * The head tags for an Appear `<style>` whose CSS `css` gives, in `useHead`'s function form: read
 * when the server writes the head, and once, so a second read can't find it written already. No
 * tag when there's none to write. Internal: the provider's, and a late chunk's (`ward.tsx`).
 */
export const appearStyle = (css: () => string): (() => Array<HeadTag>) => {
  let tags: Array<HeadTag> | undefined
  return () => {
    if (Predicate.isUndefined(tags)) tags = styleTags(css())
    return tags
  }
}

const styleTags = (css: string): Array<HeadTag> =>
  Bool.match(css === "", { onTrue: (): Array<HeadTag> => [], onFalse: (): Array<HeadTag> => [{ tag: "style", props: { "data-wardic-appear": "", children: css } }] })

/** A server render's Appear animations; `undefined` on the client, or with `appear={false}`. Internal. */
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

/** The Environment's Default transition (ADR-0051): what a key with no transition of its own runs on. Internal. */
export function useWardicDefaultTransition(): DefaultTransition.DefaultTransition["Service"] {
  return fromContext(contextValue(), "useWardicDefaultTransition", (value) => value.defaultTransition)
}

/**
 * Whether reduced motion applies now (ADR-0029): the nearest `WardicConfig`'s `reducedMotion` (#434),
 * else the provider's, and the user's preference; always `false` during a server render. Internal.
 */
export function useWardicReducedMotion(): () => boolean {
  const config = useWardicConfig()
  return fromContext(contextValue(), "useWardicReducedMotion", (value) => reducedMotionWith(value, config))
}

/**
 * Whether the elements here skip their animations now (#468): the nearest `WardicConfig`'s
 * `skipAnimations`, or the provider's Instant change while one runs (#443). Read when each starts.
 * Internal.
 */
export function useWardicSkipAnimations(): () => boolean {
  const config = skipAnimationsOf(useWardicConfig())
  const value = contextValue()
  if (Predicate.isUndefined(value)) return config
  const instant = value.instant
  return () => Bool.or(instant.active(), config())
}

/**
 * An **Instant change** of the layout (#443, Motion's `useInstantLayoutTransition`): `start(fn)` runs
 * `fn`, and the layout change it makes lands at once, a running layout animation ended too. On a
 * server it runs `fn`. As Solid 1's.
 */
export function createInstantLayoutTransition(): (fn?: () => void) => void {
  return fromContext(contextValue(), "createInstantLayoutTransition", (value) => instantLayoutOf(() => value.projection))
}

/**
 * An **Instant change** (#443, Motion's `useInstantTransition`): `start(fn)` runs `fn`, and what it
 * changes lands at once, its layout and every animation that starts until two frames after the call.
 * A later call extends it; `start.end()` ends it now. As Solid 1's.
 */
export function createInstantTransition(): InstantTransition {
  return fromContext(contextValue(), "createInstantTransition", (value) => instantTransitionOf(() => value.projection, () => value.instant))
}

/**
 * A **Projection reset** (#443, Motion's `useResetProjection`): `reset()` ends every layout animation
 * on its slot, drops every leaving twin and Switch seed, and has the next layout measure take every
 * box afresh. Nothing on a server. As Solid 1's.
 */
export function createResetProjection(): () => void {
  return fromContext(contextValue(), "createResetProjection", (value) => resetOf(() => value.projection))
}

/**
 * The reduced-motion setting that applies here (#443): the nearest `WardicConfig`'s `reducedMotion`,
 * else the provider's, else `"user"`. Read untracked for the provider's. Internal.
 */
export function useWardicReducedMotionSetting(): () => ReducedMotion.Config {
  const config = useWardicConfig()
  return fromContext(contextValue(), "useWardicReducedMotionSetting", (value) => reducedMotionSettingWith(value, config))
}

/**
 * `read` of the nearest provider's context value, named `name` in the error outside one: for a hook in
 * a module of its own (#548), such as `useWardicProjection`, which brings `layout`.
 */
export const fromWardicContext = <A,>(name: string, read: (value: WardicContextValue) => A): A => fromContext(contextValue(), name, read)

/**
 * The provider's projection system once its `layout` Feature is built (#511), read as it's needed;
 * `undefined` until then, and during a server render. For what brings no `layout` and works with the
 * layout elements that are there: an element registering its values, a presence. Internal.
 */
export function useBuiltProjection(): () => ProjectionSystem.Shape | undefined {
  return fromContext(contextValue(), "useBuiltProjection", (value) => () => value.projection)
}

/**
 * A **Declared layout change** on Solid 2 (#4, ADR-0038; #257, ADR-0046): `fn` runs at once, its
 * throw thrown here, and the promise resolves with `fn`'s result once every layout animation its
 * pass started has ended, however each ended (ADR-0039's `onSettled`, which this replaces). Calls in
 * one task share a pass, so they resolve together. It rejects with an `AbortError` if the provider
 * is disposed first. During a server render `fn` just runs, and nothing waits.
 */
export type AnimateLayout = <A>(fn: () => A) => Promise<Awaited<A>>

/** The provider's {@link AnimateLayout}. */
export function useAnimateLayout(): AnimateLayout {
  const value = contextValue()
  const declare = animateLayoutOf(value)
  const disposed = UndefinedOr.match(value, { onUndefined: constUndefined, onDefined: (v) => disposals.get(v) })
  return <A,>(fn: () => A): Promise<Awaited<A>> => {
    let settle = constUndefined as () => void
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    // A throw from `fn` is thrown here: `settled` is just dropped, unsettled.
    const result = declare(fn, { onSettled: () => settle() })
    const waiting = UndefinedOr.match(disposed, { onUndefined: () => settled, onDefined: (gone) => Promise.race([settled, gone]) })
    return waiting.then(() => result) as Promise<Awaited<A>>
  }
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
    onSettledClientOnly(() => {
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
