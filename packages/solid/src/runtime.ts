/**
 * What a `WardicProvider` holds, for the Solid 1 binding and the Solid 2 one
 * (`@wardic/solid/unstable/v2`, #209) alike: the Environment's types, the runtime and the services
 * built over it on first need, and what a server render holds instead. Solid-free: each binding's
 * provider is a thin shell over it, so the two can't drift.
 *
 * @module
 */
import type * as Announcer from "@wardic/core/Announcer"
import type * as Clock from "@wardic/core/Clock"
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Probe from "@wardic/core/Probe"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import * as FlushGate from "@wardic/dom/FlushGate"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import type * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { AtomRegistry } from "effect/reactivity"
import * as UndefinedOr from "effect/UndefinedOr"
import type { ServerAppear } from "./appear.ts"
import { clientRegistry, type FeatureRegistry, type FeatureSection, serverRegistry } from "./feature.ts"
import { type InstantAnimations, makeInstantAnimations, NO_INSTANT } from "./instant.ts"
import { settingOf as configSettingOf, type WardicConfigValue } from "./wardic-config-value.ts"

/**
 * The full Wardic environment a `WardicProvider` requires: core's service contracts but the
 * `InputSource`, the `RefreshFrameSource` the Clock ticks on and the flush gate requests its
 * flushes from, core's Frame loop over the Clock (`FrameLoop.layer`, which runs every
 * animation the binding starts), and the `AtomRegistry` that backs reactive service
 * inputs. Satisfied by `@wardic/dom`'s `DomLive` (real browser) or `@wardic/test`'s
 * `TestLive` (headless). `ER` and `R` are `never`: a fully self-contained Layer. The `InputSource` is
 * the gesture Features': built with the first one, over the page, unless
 * the Environment gives one, as `TestLive` does, which they take.
 */
export type WardicEnv = Layer.Layer<WardicServices, never, never>

/** The runtime services a `WardicProvider` makes available to its subtree. */
export type WardicServices =
  | Clock.Clock
  | RefreshFrameSource.RefreshFrameSource
  | FrameLoop.FrameLoop
  | Renderer.Renderer
  | Probe.Probe
  | InterpolatorRegistry.InterpolatorRegistry
  | ReducedMotion.PositionalKeys
  | DefaultTransition.DefaultTransition
  | Announcer.Announcer
  | AtomRegistry.AtomRegistry

/** The `ManagedRuntime` flavour built from a {@link WardicEnv}. */
export type WardicRuntime = ManagedRuntime.ManagedRuntime<WardicServices, never>

/**
 * What a client provider hands its projection system (#511): whether reduced motion applies now
 * (ADR-0029), and the app's scale correctors (#443). The `layout` Feature's Layer reads it from the
 * provider's runtime, as the projection system is no longer built with it.
 */
export class ProjectionOptions extends /*#__PURE__*/ Context.Service<ProjectionOptions, ProjectionSystem.Options>()("@wardic/solid/ProjectionOptions") {}

/** What a provider's runtime holds: its Environment, and its flush gate and projection options over it. */
export type ProviderServices = WardicServices | FlushGate.FlushGate | ProjectionOptions

/** A provider's runtime, as its Features build on it. */
export type ProviderRuntime = ManagedRuntime.ManagedRuntime<ProviderServices, never>

/** A server render's Positional keys: it builds no runtime, and reduced motion never applies there. */
export const SERVER_POSITIONAL_KEYS: ReducedMotion.PositionalKeys["Service"] = { isPositional: ReducedMotion.isTransform }

/** A server render's Default transition: it runs no animation (its Appear animations read the DOM's, #48). */
export const SERVER_DEFAULT_TRANSITION: DefaultTransition.DefaultTransition["Service"] = { transitionFor: () => DefaultTransition.ONE_SPRING, keyframes: DefaultTransition.ONE_TWEEN }

/**
 * The value a `WardicProvider` carries down the tree: the single Effect runtime
 * plus the provider-owned flush gate (ADR-0006) built atop it.
 */
export interface WardicContextValue {
  readonly runtime: WardicRuntime
  readonly gate: FlushGate.Shape
  /**
   * Its projection system (ADR-0009), once its `layout` Feature is built (#511): by an element whose
   * section has it, or a component that brings it. Read as it's needed, so nothing waits on it; and
   * `undefined` until then, as during a server render, which builds none (ADR-0021).
   */
  readonly projection: ProjectionSystem.Shape | undefined
  /** Whether reduced motion applies now (ADR-0029): read when each animation starts. */
  readonly reducedMotion: () => boolean
  /**
   * Whether reduced motion applies now under `setting` (#434): a `WardicConfig`'s, else the
   * provider's, with the user's preference. Read when each animation starts.
   */
  readonly reducedMotionUnder: (setting: ReducedMotion.Config | undefined) => boolean
  /**
   * The provider's own `reducedMotion` setting (#443): `undefined` when it gives none. Tracked, so a
   * hook that reads it follows a change of it (#584); animations read it untracked, as each starts.
   */
  readonly reducedMotionSetting: () => ReducedMotion.Config | undefined
  /** The Environment's Positional keys (ADR-0036), read once: which keys reduced motion Snaps. */
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  /** The Environment's Default transition (ADR-0051), read once: what a key with no transition of its own runs on. */
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
  /** A server render's Appear animations (#48, ADR-0044); none on the client, or with `appear={false}`. */
  readonly appear?: ServerAppear | undefined
  /** Whether its animations are instant now (#443, an Instant change's); never on a server. */
  readonly instant: InstantAnimations
  /**
   * Its **Features** (#511, ADR-0067), each built once on first need into the runtime's `MemoMap`; a
   * server render's run their `server` part alone. Disposing them disposes the runtime after.
   */
  readonly features: FeatureRegistry
  /**
   * Build what a first element would (#535): the runtime, its Environment and the gate, and the first
   * animation's code warmed through the interpolators nearly every app uses. A provider runs it at
   * the browser's idle time once it has mounted; a first element before then builds them itself.
   * Nothing on a server.
   */
  readonly prepare: () => void
}

/** What a client provider builds on first need (#51): everything in its context but the runtime. */
interface Built {
  readonly gate: FlushGate.Shape
  readonly reducedMotion: () => boolean
  readonly reducedMotionUnder: (setting: ReducedMotion.Config | undefined) => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
}

/**
 * A client provider's runtime and context value. The runtime is made once from `env`, over which
 * it builds the flush gate, running a frame's Starting-style switches through `batch` (ADR-0034:
 * Solid 1's `batch`, Solid 2's apply-then-`flush()`), a service built by its Layer and ended by its
 * Scope (#132, ADR-0041). Making it builds nothing (it's Effect's `ManagedRuntime`). The projection
 * system is the `layout` Feature's (#511), built on the runtime when it's first needed, and ended
 * before it.
 *
 * The rest is built on first need (#51, ADR-0021 *Amendment (#51)*): together, the first time a
 * Wardic element or hook reads any of it from the context value, which is during the first
 * element's render. A provider with no Wardic element under it builds nothing. Reading the runtime
 * alone builds none of it. `reducedMotion` is the provider's setting, read untracked by the caller.
 */
export const clientContext = (
  env: WardicEnv,
  batch: (apply: () => void) => void,
  reducedMotion: () => ReducedMotion.Config | undefined,
  reducedMotionSetting: () => ReducedMotion.Config | undefined,
  scaleCorrectors?: ProjectionSystem.Options["scaleCorrectors"],
): WardicContextValue => {
  let built: Built | undefined
  const build = (): Built => {
    if (Predicate.isNotUndefined(built)) return built
    // The flush gate, one per WardicProvider (ADR-0006): reading it builds the runtime, the
    // Environment and the gate together.
    const gate = runtime.runSync(FlushGate.FlushGate)
    // Whether reduced motion applies now (ADR-0029): the app's setting (a `WardicConfig`'s, #434, else
    // the provider's) and the user's preference through the Probe's atom. Read when each animation
    // starts, so a change applies from the next one.
    const registry = runtime.runSync(AtomRegistry.AtomRegistry)
    const probe = runtime.runSync(Probe.Probe)
    const under = (setting: ReducedMotion.Config | undefined): boolean =>
      ReducedMotion.applies(settingOf(setting, reducedMotion), registry.get(probe.prefersReducedMotion))
    const applies = (): boolean => under(undefined)
    // Which keys reduced motion Snaps: the Environment's Positional keys (ADR-0036), read once, as
    // the Probe is.
    const positionalKeys = runtime.runSync(ReducedMotion.PositionalKeys)
    // What a key with no transition of its own runs on: the Environment's Default transition
    // (ADR-0051), read once too.
    const defaultTransition = runtime.runSync(DefaultTransition.DefaultTransition)
    built = { gate, reducedMotion: applies, reducedMotionUnder: under, positionalKeys, defaultTransition }
    return built
  }
  // What the `layout` Feature builds its projection system with (#511): reduced motion read as each
  // layout animation starts, and the app's scale correctors.
  const projectionOptions: ProjectionSystem.Options = { reducedMotion: () => build().reducedMotion(), scaleCorrectors }
  const runtime: ProviderRuntime = ManagedRuntime.make(
    Layer.merge(FlushGate.layer({ batch }), Layer.succeed(ProjectionOptions)(projectionOptions)).pipe(Layer.provideMerge(env)),
  )
  const features = clientRegistry(runtime)
  // Its Instant changes (#443), timed by its Environment's Refresh frames, found at the first.
  const instant = makeInstantAnimations(() => runtime.runSync(RefreshFrameSource.RefreshFrameSource).requestFrame)
  const prepare = (): void => {
    build()
    warmInterpolators(runtime)
  }
  return {
    runtime,
    reducedMotionSetting,
    instant,
    features,
    prepare,
    get gate() {
      return build().gate
    },
    get projection() {
      return projectionIn(features.built())
    },
    get reducedMotion() {
      return build().reducedMotion
    },
    get reducedMotionUnder() {
      return build().reducedMotionUnder
    },
    get positionalKeys() {
      return build().positionalKeys
    },
    get defaultTransition() {
      return build().defaultTransition
    },
  }
}

/**
 * Whether reduced motion applies now for an element under `config` (#434): its nearest
 * `WardicConfig`'s setting, else the provider's; with no config above, the provider's reader as it is.
 */
export const reducedMotionWith = (value: WardicContextValue, config: WardicConfigValue | undefined): (() => boolean) => {
  if (Predicate.isUndefined(config)) return value.reducedMotion
  const under = value.reducedMotionUnder
  return () => under(config.reducedMotion())
}

/**
 * The reduced-motion setting that applies to an element under `config` (#443, Motion's
 * `useReducedMotionConfig`): its nearest `WardicConfig`'s, else the provider's, else `"user"`.
 */
export const reducedMotionSettingWith = (value: WardicContextValue, config: WardicConfigValue | undefined): (() => ReducedMotion.Config) =>
  () => settingOf(configSettingOf(config), value.reducedMotionSetting)

/** A setting: the given one (a `WardicConfig`'s), else the provider's, else `"user"`. */
const settingOf = (setting: ReducedMotion.Config | undefined, provider: () => ReducedMotion.Config | undefined): ReducedMotion.Config => {
  if (Predicate.isNotUndefined(setting)) return setting
  return Option.getOrElse(Option.fromUndefinedOr(provider()), () => "user" as const)
}

/**
 * A server provider's context value (ADR-0021, decisions 1 and 3): an unbuilt runtime (`make`
 * alone builds nothing, 0.92 µs, so code that grabs it at setup and uses it after mount keeps
 * working), an inert gate, no projection system, reduced motion never applying, and the render's
 * Appear animations when it has them.
 */
export const serverContext = (env: WardicEnv, appear: ServerAppear | undefined, reducedMotion: () => ReducedMotion.Config | undefined): WardicContextValue => {
  const runtime = ManagedRuntime.make(env)
  return {
    runtime,
    features: serverRegistry(runtime),
    prepare: constVoid,
    gate: FlushGate.inert,
    projection: undefined,
    reducedMotion: () => false,
    reducedMotionUnder: () => false,
    reducedMotionSetting: reducedMotion,
    positionalKeys: SERVER_POSITIONAL_KEYS,
    defaultTransition: SERVER_DEFAULT_TRANSITION,
    appear,
    instant: NO_INSTANT,
  }
}

/**
 * Pairs nearly every app animates (#535): a number (opacity, the transform shorthands), a length and a
 * colour. Resolving them runs the registry's selection, parsers and blends once, so a first animation
 * after it runs them warm. Its cache is by the pair's own strings, so it's the code they warm.
 */
const WARM_PAIRS: ReadonlyArray<readonly [number | string, number | string]> = [
  [0, 1],
  ["0px", "10px"],
  ["rgb(0, 0, 0)", "rgb(255, 255, 255)"],
]

/** Resolve {@link WARM_PAIRS} on `runtime`'s registry, and blend each once. */
const warmInterpolators = (runtime: ProviderRuntime): void => {
  const registry = runtime.runSync(InterpolatorRegistry.InterpolatorRegistry)
  Arr.forEach(WARM_PAIRS, ([from, to]) => {
    runtime.runSync(Effect.map(registry.resolve(from, to), (blend) => blend(0.5)))
  })
}

/** How long a provider's {@link whenIdle} waits for an idle moment at most (#535), in ms. */
const IDLE_TIMEOUT_MS = 250

/** Where there's no `requestIdleCallback` (Safari), the timer it runs on instead (#535), in ms. */
const IDLE_FALLBACK_MS = 50

/**
 * Run `fn` at the browser's idle time, within {@link IDLE_TIMEOUT_MS} (#535), or after
 * {@link IDLE_FALLBACK_MS} where there's no `requestIdleCallback`. Returns its cancel.
 */
export const whenIdle = (fn: () => void): (() => void) => {
  if (Predicate.isFunction(globalThis.requestIdleCallback)) {
    const handle = globalThis.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS })
    return () => globalThis.cancelIdleCallback(handle)
  }
  const handle = setTimeout(fn, IDLE_FALLBACK_MS)
  return () => clearTimeout(handle)
}

/**
 * What a provider builds at the browser's idle time once it has mounted (#535): `value`'s `prepare`,
 * and `section`'s Features, its own. A failure here is left to the first element, whose own build
 * fails the same way and reports it where it renders.
 */
export const prepareIdle = (value: WardicContextValue, section: FeatureSection): void => {
  try {
    value.prepare()
    section.services()
  } catch {
    // Left to the first element's build, which reports it.
  }
}

/** Reads `pick` off a provider's context value, or throws `name`'s clear error outside one. */
export const fromContext = <A>(value: WardicContextValue | undefined, name: string, pick: (value: WardicContextValue) => A): A => {
  if (Predicate.isUndefined(value)) throw new Error(`${name} must be used within a <WardicProvider>`)
  return pick(value)
}

/** The projection system among `services`, the `layout` Feature's (#511), or `undefined` when they hold none. */
export const projectionIn = (services: Context.Context<never>): ProjectionSystem.Shape | undefined =>
  Option.getOrUndefined(Context.getOption(services as Context.Context<ProjectionSystem.ProjectionSystem>, ProjectionSystem.ProjectionSystem))

/**
 * `useAnimateLayout()`'s function: `animateLayout(fn, options?)` runs `fn` at once, animates the
 * layout change it makes, and returns what `fn` returns. `options.onSettled` is called once every
 * layout animation the change started has ended.
 */
// A Declared layout change (#4, ADR-0038); `onSettled` is #191's, ADR-0039.
export type AnimateLayout = <A>(fn: () => A, options?: ProjectionSystem.AnimateLayoutOptions) => A

const NO_OPTIONS: ProjectionSystem.AnimateLayoutOptions = {}

/** During a server render nothing is measured: `fn` just runs, and with nothing to animate it has settled (ADR-0021). */
const runOnly: AnimateLayout = (fn, options = NO_OPTIONS) => {
  const result = fn()
  UndefinedOr.map(options.onSettled, (onSettled) => onSettled())
  return result
}

/**
 * A provider's `animateLayout` (#4, ADR-0038), its projection system's read at each call (#511): `fn`
 * just run until a section builds `layout`, as with no layout element there's nothing to animate, and
 * during a server render.
 */
export const animateLayoutOf = (value: WardicContextValue | undefined): AnimateLayout =>
  fromContext(
    value,
    "useAnimateLayout",
    (v): AnimateLayout =>
      (fn, options) =>
        UndefinedOr.match(v.projection, { onUndefined: () => runOnly(fn, options), onDefined: (projection) => projection.animateLayout(fn, options) }),
  )

/**
 * A fiber's effect as `runScoped` runs it: a failure logged at Error, `wardic.runScoped: a fiber
 * failed`, with its cause, and reported to the Environment's `ErrorReporter`s (ADR-0030, decision
 * 4); an interruption is neither. The fiber still fails with it.
 */
export const reported = <A, E>(effect: Effect.Effect<A, E, WardicServices>): Effect.Effect<A, E, WardicServices> =>
  effect.pipe(Effect.tapCause((cause) => Report.failure("wardic.runScoped: a fiber failed", cause)))

/** A fiber that has already ended by interruption, on no Wardic runtime (1.1 µs): what a server render starts. */
export const interrupted = <A, E>(): Fiber.Fiber<A, E> => Effect.runFork(Effect.interrupt) as unknown as Fiber.Fiber<A, E>
