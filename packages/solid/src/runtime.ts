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
import type * as InputSource from "@wardic/core/InputSource"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Probe from "@wardic/core/Probe"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import * as FlushGate from "@wardic/dom/FlushGate"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { AtomRegistry } from "effect/reactivity"
import * as UndefinedOr from "effect/UndefinedOr"
import type { ServerAppear } from "./appear.ts"
import { type InstantAnimations, makeInstantAnimations, NO_INSTANT } from "./instant.ts"
import { settingOf as configSettingOf, type WardicConfigValue } from "./wardic-config-value.ts"

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
  | ReducedMotion.PositionalKeys
  | DefaultTransition.DefaultTransition
  | Announcer.Announcer
  | AtomRegistry.AtomRegistry

/** The `ManagedRuntime` flavour built from a {@link WardicEnv}. */
export type WardicRuntime = ManagedRuntime.ManagedRuntime<WardicServices, never>

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
  /** `undefined` during a server render, which builds no projection system (ADR-0021). */
  readonly projection: ProjectionSystem.Shape | undefined
  /** Whether reduced motion applies now (ADR-0029): read when each animation starts. */
  readonly reducedMotion: () => boolean
  /**
   * Whether reduced motion applies now under `setting` (#434): a `WardicConfig`'s, else the
   * provider's, with the user's preference. Read when each animation starts.
   */
  readonly reducedMotionUnder: (setting: ReducedMotion.Config | undefined) => boolean
  /** The provider's own `reducedMotion` setting (#443), read untracked: `undefined` when it gives none. */
  readonly reducedMotionSetting: () => ReducedMotion.Config | undefined
  /** The Environment's Positional keys (ADR-0036), read once: which keys reduced motion Snaps. */
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  /** The Environment's Default transition (ADR-0051), read once: what a key with no transition of its own runs on. */
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
  /** A server render's Appear animations (#48, ADR-0044); none on the client, or with `appear={false}`. */
  readonly appear?: ServerAppear | undefined
  /** Whether its animations are instant now (#443, an Instant change's); never on a server. */
  readonly instant: InstantAnimations
}

/** What a client provider builds on first need (#51): everything in its context but the runtime. */
interface Built {
  readonly gate: FlushGate.Shape
  readonly projection: ProjectionSystem.Shape
  readonly reducedMotion: () => boolean
  readonly reducedMotionUnder: (setting: ReducedMotion.Config | undefined) => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
}

/**
 * A client provider's runtime and context value. The runtime is made once from `env`, over which
 * it builds the flush gate, running a frame's Starting-style switches through `batch` (ADR-0034:
 * Solid 1's `batch`, Solid 2's apply-then-`flush()`), and the projection system writing through it
 * (#132, ADR-0041): services built by their Layers and ended by its Scope, the projection system
 * before the gate. Making it builds nothing (it's Effect's `ManagedRuntime`).
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
  scaleCorrectors?: ProjectionSystem.Options["scaleCorrectors"],
): WardicContextValue => {
  let built: Built | undefined
  const build = (): Built => {
    if (Predicate.isNotUndefined(built)) return built
    // The flush gate, one per WardicProvider (ADR-0006): reading it builds the runtime, the
    // Environment, the gate and the projection system together.
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
    // The box-based projection system (ADR-0009), provider-owned like the gate: the projection nodes,
    // the coordinator (a run on the Frame loop), and `layoutId` matching end to end, so `layoutId`
    // works with no `<LayoutGroup>` (Motion parity) and the binding keeps no registry.
    const projection = runtime.runSync(ProjectionSystem.ProjectionSystem)
    built = { gate, projection, reducedMotion: applies, reducedMotionUnder: under, positionalKeys, defaultTransition }
    return built
  }
  const runtime = ManagedRuntime.make(
    ProjectionSystem.layer({ reducedMotion: () => build().reducedMotion(), scaleCorrectors }).pipe(
      Layer.provideMerge(FlushGate.layer({ batch })),
      Layer.provideMerge(env),
    ),
  )
  // Its Instant changes (#443), timed by its Environment's Refresh frames, found at the first.
  const instant = makeInstantAnimations(() => runtime.runSync(RefreshFrameSource.RefreshFrameSource).requestFrame)
  return {
    runtime,
    reducedMotionSetting: reducedMotion,
    instant,
    get gate() {
      return build().gate
    },
    get projection() {
      return build().projection
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
export const serverContext = (env: WardicEnv, appear: ServerAppear | undefined, reducedMotion: () => ReducedMotion.Config | undefined): WardicContextValue => ({
  runtime: ManagedRuntime.make(env),
  gate: FlushGate.inert,
  projection: undefined,
  reducedMotion: () => false,
  reducedMotionUnder: () => false,
  reducedMotionSetting: reducedMotion,
  positionalKeys: SERVER_POSITIONAL_KEYS,
  defaultTransition: SERVER_DEFAULT_TRANSITION,
  appear,
  instant: NO_INSTANT,
})

/** Reads `pick` off a provider's context value, or throws `name`'s clear error outside one. */
export const fromContext = <A>(value: WardicContextValue | undefined, name: string, pick: (value: WardicContextValue) => A): A => {
  if (Predicate.isUndefined(value)) throw new Error(`${name} must be used within a <WardicProvider>`)
  return pick(value)
}

/**
 * The projection system off a provider's context value (ADR-0009), or a clear error outside one
 * or during a server render, which builds none (ADR-0021).
 */
export const projectionOf = (value: WardicContextValue | undefined): ProjectionSystem.Shape =>
  fromContext(value, "useWardicProjection", (v) => {
    if (Predicate.isUndefined(v.projection)) throw new Error("useWardicProjection: there is no projection system during a server render (ADR-0021)")
    return v.projection
  })

/**
 * A **Declared layout change**: run `fn`, and animate the layout change it makes. Returns `fn`'s
 * result. `onSettled` is called once the change has settled (#191, ADR-0039).
 */
export type AnimateLayout = <A>(fn: () => A, options?: ProjectionSystem.AnimateLayoutOptions) => A

const NO_OPTIONS: ProjectionSystem.AnimateLayoutOptions = {}

/** During a server render nothing is measured: `fn` just runs, and with nothing to animate it has settled (ADR-0021). */
const runOnly: AnimateLayout = (fn, options = NO_OPTIONS) => {
  const result = fn()
  UndefinedOr.map(options.onSettled, (onSettled) => onSettled())
  return result
}

/** A provider's `animateLayout` (#4, ADR-0038), or `fn` just run during a server render. */
export const animateLayoutOf = (value: WardicContextValue | undefined): AnimateLayout =>
  fromContext(value, "useAnimateLayout", (v) => UndefinedOr.match(v.projection, { onUndefined: () => runOnly, onDefined: (projection) => projection.animateLayout }))

/**
 * A fiber's effect as `runScoped` runs it: a failure logged at Error, `wardic.runScoped: a fiber
 * failed`, with its cause, and reported to the Environment's `ErrorReporter`s (ADR-0030, decision
 * 4); an interruption is neither. The fiber still fails with it.
 */
export const reported = <A, E>(effect: Effect.Effect<A, E, WardicServices>): Effect.Effect<A, E, WardicServices> =>
  effect.pipe(Effect.tapCause((cause) => Report.failure("wardic.runScoped: a fiber failed", cause)))

/** A fiber that has already ended by interruption, on no Wardic runtime (1.1 µs): what a server render starts. */
export const interrupted = <A, E>(): Fiber.Fiber<A, E> => Effect.runFork(Effect.interrupt) as unknown as Fiber.Fiber<A, E>
