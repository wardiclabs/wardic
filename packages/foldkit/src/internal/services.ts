/**
 * Where elements get Wardic's services (ADR-0071, decisions 9 and 31; *Amendment (#791)*): the seam
 * that differs on Foldkit's preview. On 0.170, a **Handle** (`Wardic.make`) holds its **Provider**:
 * Wardic's Layer built on the Handle's `env` into a Scope the Handle owns, by the first `w.*` element to
 * mount while none is live, on that element's Mount fiber (so Foldkit's scheduler is inherited, decision
 * 11), inside the patch (P2). Every `w.*` element counts itself in at mount and out at its release; once
 * the last has left, the Handle closes the Scope at the end of the task, so a patch that swaps every
 * element keeps the runtime. `w.Provider(options)` names the element the subtree options hang on (slice
 * 2's); a second one while that element is mounted is reported and ignored.
 *
 * @module
 */
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Probe from "@wardic/core/Probe"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as MeasuredPairs from "@wardic/core/unstable/MeasuredPairs"
import * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as VariableValues from "@wardic/core/unstable/VariableValues"
import * as WardicServices from "@wardic/core/unstable/WardicServices"
import * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import * as Feature from "@wardic/dom/unstable/Feature"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { constFalse } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Scope from "effect/Scope"
import type * as Ward from "../Ward.ts"

/** A live **Provider**: Wardic's services built on an app's `env`, read once, as a Solid provider's context value holds them. */
export interface Provider {
  /** Its runtime: the Runner the legs fork on, with the memo map its Features build into. */
  readonly runtime: Feature.FeatureRuntime
  /** Its flush gate (ADR-0006). */
  readonly gate: FlushGate.Shape
  /** Whether reduced motion applies now (ADR-0029): the user's preference, read as each animation starts. */
  readonly reducedMotion: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
  /** Its elements' reads of their values (#672): the Environment's, the DOM's where it gives none. */
  readonly valueReads: ElementSetup.ElementValueReads
  /** Its Features (#511), each built on first need. */
  readonly registry: Feature.FeatureRegistry
  /** The Scope the Handle owns it in: closed once its last element has left. */
  readonly scope: Scope.Closeable
  /** The element carrying `w.Provider(options)`, while it's mounted: what the subtree options (slice 2) hang on. */
  root: Element | undefined
  /** Its mounted `w.*` elements, counted. */
  elements: number
}

/** What a Handle holds of its provider: the live one, the `Deferred` a build in flight completes, and its Features. */
export interface State {
  readonly env: WardicServices.WardicEnv
  /**
   * Its Features (#516), as given: kept for slice 3, where its elements' gesture and layout attributes
   * bring them through the provider's registry. Nothing reads them in slice 1.
   */
  readonly features: Feature.InstanceFeaturesProp | undefined
  deferred: Deferred.Deferred<Provider>
  live: Provider | undefined
  /** Whether a build is in flight: an `env` that waits as it builds has the elements after the first await the `Deferred`. */
  building: boolean
}

/** A Handle's state: no provider yet. */
export const makeState = (env: WardicServices.WardicEnv, features: Feature.InstanceFeaturesProp | undefined): State => ({
  env,
  features,
  deferred: Deferred.makeUnsafe<Provider>(),
  live: undefined,
  building: false,
})

/** A second `w.Provider()` for one Handle, while the first's element is mounted: reported, then ignored. */
const SECOND_PROVIDER =
  "wardic.provider: a second w.Provider() mounted while this Handle's is. A Handle has one: put w.Provider() on one w.* element at " +
  "the top of the view, or make a Handle (Wardic.make) for each program."

/** An Option's value, or `undefined`: an optional Environment member read from a built context. */
const optional = <S extends Context.Service<any, any>>(context: Context.Context<never>, service: S): Context.Service.Shape<S> | undefined =>
  Option.getOrUndefined(Context.getOption(context as Context.Context<S>, service))

/**
 * Build Wardic's Layer on `state`'s `env` into a Scope of the Handle's own, with the flush gate and the
 * projection options a provider adds (ADR-0006), on the current fiber: the first element's Mount's.
 */
const build = (state: State): Effect.Effect<Provider> =>
  Effect.gen(function* () {
    const scope = Scope.makeUnsafe()
    const memoMap = Layer.makeMemoMapUnsafe()
    // Read as each layout animation starts (slice 2), through the Provider's own reader once it's made.
    let reducedMotionNow: () => boolean = constFalse
    const projection: ProjectionSystem.Options = { reducedMotion: () => reducedMotionNow() }
    const layer = Layer.merge(FlushGate.layer({ batch: (apply) => apply() }), Layer.succeed(Feature.ProjectionOptions)(projection)).pipe(Layer.provideMerge(state.env))
    const context = yield* Layer.buildWithMemoMap(layer, memoMap, scope)
    const runner = yield* Effect.provideContext(WardicServices.makeRunner<Feature.ProviderServices>(), Context.add(context, Scope.Scope, scope))
    const runtime: Feature.FeatureRuntime = { ...runner, memoMap }
    // The user's preference, through the Probe's atom (ADR-0029); an app's setting comes with `w.Config` (slice 1, PR 2).
    const registry = Context.get(context, AtomRegistry.AtomRegistry)
    const probe = Context.get(context, Probe.Probe)
    const reducedMotion = (): boolean => ReducedMotion.applies("user", registry.get(probe.prefersReducedMotion))
    reducedMotionNow = reducedMotion
    const services = context as Context.Context<never>
    return {
      runtime,
      gate: Context.get(context, FlushGate.FlushGate),
      reducedMotion,
      positionalKeys: Context.get(context, ReducedMotion.PositionalKeys),
      defaultTransition: Context.get(context, DefaultTransition.DefaultTransition),
      valueReads: ElementSetup.valueReadsOf({
        ownValues: optional(services, OwnValues.OwnValues),
        measuredPairs: optional(services, MeasuredPairs.MeasuredPairs),
        variableValues: optional(services, VariableValues.VariableValues),
      }),
      // Its Features' Scope is a child of the runtime's, closed with it: nothing more to dispose.
      registry: Feature.clientRegistry(runtime, () => Promise.resolve()),
      scope,
      root: undefined,
      elements: 0,
    }
  })

/**
 * The Handle's Provider for a mounting element: the live one; else, with a build in flight, the one
 * its `Deferred` completes with; else built now, on this fiber. With `options` (the element carries
 * `w.Provider(options)`), `element` becomes the Provider's root, unless another is mounted as one.
 */
export const providerFor = (state: State, element: Element, options: Ward.ProviderOptions | undefined): Effect.Effect<Provider> =>
  Effect.gen(function* () {
    let provider = state.live
    if (Predicate.isUndefined(provider)) provider = yield* Bool.match(state.building, { onTrue: () => Deferred.await(state.deferred), onFalse: () => first(state) })
    if (Predicate.isNotUndefined(options)) yield* takeRoot(provider, element)
    return provider
  })

/** The first element's build: the Provider made live, and the `Deferred` done for the elements after it. */
const first = (state: State): Effect.Effect<Provider> =>
  Effect.gen(function* () {
    state.building = true
    const provider = yield* build(state)
    state.building = false
    state.live = provider
    Deferred.doneUnsafe(state.deferred, Effect.succeed(provider))
    return provider
  })

/** `element` as `provider`'s root, unless another is mounted as one: then reported, and ignored. */
const takeRoot = (provider: Provider, element: Element): Effect.Effect<void> => {
  if (Predicate.isUndefined(provider.root)) {
    provider.root = element
    return Effect.void
  }
  return Report.failure(SECOND_PROVIDER, Cause.die(new Error(SECOND_PROVIDER)))
}

/**
 * Count a mounted element in. Returns what its release calls: the count out, the root given up when it
 * was this element, and, once the last element has left, the Scope closed at the end of the task, so a
 * patch that removes every element and inserts new ones keeps the runtime.
 */
export const joined = (state: State, provider: Provider, element: Element): (() => void) => {
  provider.elements++
  return () => {
    provider.elements--
    if (provider.root === element) provider.root = undefined
    if (provider.elements > 0) return
    queueMicrotask(() => {
      if (provider.elements > 0) return
      if (state.live !== provider) return
      state.live = undefined
      state.deferred = Deferred.makeUnsafe<Provider>()
      Effect.runFork(Scope.close(provider.scope, Exit.void))
    })
  }
}
