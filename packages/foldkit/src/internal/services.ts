/**
 * Where elements get Wardic's services (ADR-0071, decisions 9 and 31): the seam that differs on
 * Foldkit's preview. On 0.170, a **Handle** (`Wardic.make`) holds a `Deferred` of its **Provider**: the
 * `w.*` element carrying `w.Provider()` builds Wardic's Layer into its Mount's Scope at insert (P2) and
 * completes it, and every other element's Mount awaits it, resumed inline when it's done in the same
 * patch. The provider's release resets the Handle, so a provider mounted later builds afresh; a second
 * one mounting while one is live is reported and ignored (#791, Q3).
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
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { constFalse } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type * as Scope from "effect/Scope"
import { DEV } from "@wardic/foldkit/internal/dev"

/** A live **Provider**: Wardic's services built on an app's `env`, read once, as a Solid provider's context value holds them. */
export interface Provider {
  /** The element whose Mount built it. */
  readonly element: Element
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
}

/** What a Handle holds of its provider: the `Deferred` elements await, the live one, and whether it warned. */
export interface State {
  readonly env: WardicServices.WardicEnv
  deferred: Deferred.Deferred<Provider>
  live: Provider | undefined
  warned: boolean
}

/** A Handle's state: no provider yet. */
export const makeState = (env: WardicServices.WardicEnv): State => ({ env, deferred: Deferred.makeUnsafe<Provider>(), live: undefined, warned: false })

/** A second provider for one Handle, while one is live (#791, Q3): reported, then ignored. */
const SECOND_PROVIDER =
  "wardic.provider: a second w.Provider() mounted while this Handle's provider is live. A Handle has one provider at a time: " +
  "put w.Provider() on one w.* element at the top of the view, or make a Handle (Wardic.make) for each program."

/** What a `w.*` element waits for in vain: no provider above it, after a frame, in development. */
const NO_PROVIDER =
  "wardic: a w.* element has waited a frame for its Handle's provider. Put w.Provider() on a w.* element at the top of the " +
  "view, above every other w.* element, so its Mount builds Wardic's services (ADR-0071, decision 9)."

/** How long a `w.*` element waits before development says there's no provider: about a frame, in ms. */
const WAIT_BEFORE_WARNING_MS = 32

/** An Option's value, or `undefined`: an optional Environment member read from a built context. */
const optional = <S extends Context.Service<any, any>>(context: Context.Context<never>, service: S): Context.Service.Shape<S> | undefined =>
  Option.getOrUndefined(Context.getOption(context as Context.Context<S>, service))

/**
 * Build Wardic's Layer into the current Scope (a provider's Mount Scope) on `state`'s `env`, with the
 * flush gate and the projection options a provider adds (ADR-0006), and complete the Handle's
 * `Deferred` with the Provider, resuming every element waiting on it inline. The Scope's close resets
 * the Handle before the Layer tears down.
 */
export const provide = (state: State, element: Element): Effect.Effect<Provider, never, Scope.Scope> =>
  Effect.gen(function* () {
    const live = state.live
    if (Predicate.isNotUndefined(live)) {
      yield* Report.failure(SECOND_PROVIDER, Cause.die(new Error(SECOND_PROVIDER)))
      return live
    }
    const scope = yield* Effect.scope
    const memoMap = Layer.makeMemoMapUnsafe()
    // Read as each layout animation starts (slice 2), through the Provider's own reader once it's made.
    let reducedMotionNow: () => boolean = constFalse
    const projection: ProjectionSystem.Options = { reducedMotion: () => reducedMotionNow() }
    const layer = Layer.merge(FlushGate.layer({ batch: (apply) => apply() }), Layer.succeed(Feature.ProjectionOptions)(projection)).pipe(Layer.provideMerge(state.env))
    const context = yield* Layer.buildWithMemoMap(layer, memoMap, scope)
    const runner = yield* Effect.provideContext(WardicServices.makeRunner<Feature.ProviderServices>(), context)
    const runtime: Feature.FeatureRuntime = { ...runner, memoMap }
    // The user's preference, through the Probe's atom (ADR-0029); an app's setting comes with `w.Config` (slice 1, PR 2).
    const registry = Context.get(context, AtomRegistry.AtomRegistry)
    const probe = Context.get(context, Probe.Probe)
    const reducedMotion = (): boolean => ReducedMotion.applies("user", registry.get(probe.prefersReducedMotion))
    reducedMotionNow = reducedMotion
    const services = context as Context.Context<never>
    const provider: Provider = {
      element,
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
      // Its Features' Scope is a child of the runtime's, closed with the Mount's: nothing more to dispose.
      registry: Feature.clientRegistry(runtime, () => Promise.resolve()),
    }
    state.live = provider
    Deferred.doneUnsafe(state.deferred, Effect.succeed(provider))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (state.live !== provider) return
        state.live = undefined
        state.deferred = Deferred.makeUnsafe<Provider>()
      }),
    )
    return provider
  })

/**
 * The Handle's Provider: the live one, else the one its `Deferred` completes with. In development, an
 * element still waiting after about a frame says so once per Handle, and keeps waiting.
 */
export const awaitProvider = (state: State): Effect.Effect<Provider> =>
  Effect.gen(function* () {
    const live = state.live
    if (Predicate.isNotUndefined(live)) return live
    if (DEV) {
      const soon = yield* Effect.timeoutOption(Deferred.await(state.deferred), Duration.millis(WAIT_BEFORE_WARNING_MS))
      if (Option.isSome(soon)) return soon.value
      if (!state.warned) {
        state.warned = true
        yield* Effect.logWarning(NO_PROVIDER)
      }
    }
    return yield* Deferred.await(state.deferred)
  })
