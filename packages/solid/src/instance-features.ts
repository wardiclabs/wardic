/**
 * A **Wardic instance**'s Features (#516, ADR-0067 *Amendment (#516)*), for both bindings: what
 * `createWardic` splits its list into, and what its elements and hooks take in each provider. In a module
 * that only `createWardic` imports, apart from the spine every page shares, so an app with no Wardic
 * instance ships none of it (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import { constVoid, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import {
  type Build,
  type Feature,
  type FeatureLoad,
  type FeatureRegistry,
  type Features,
  type InstanceFeatures,
  type InstanceFeaturesProp,
  joinOwns,
  type Own,
  ownOf,
  type SectionHost,
} from "./feature.ts"

/**
 * `prop`'s Features (#516): those given at once, flattened, each once, and its loads, each started once,
 * the first time any provider asks, so one module's Wardic instance loads each once.
 */
export const instanceFeaturesOf = (prop: InstanceFeaturesProp): InstanceFeatures => {
  const leaves = leavesOf(prop)
  const given = Arr.dedupeWith(Arr.filter(leaves, isFeature), (a, b) => a === b)
  const loads = Arr.map(Arr.filter(leaves, isLoad), once)
  const owns = new WeakMap<FeatureRegistry, Own>()
  return {
    own: (registry, host) =>
      UndefinedOr.match(owns.get(registry), {
        onDefined: identity,
        onUndefined: () => {
          const own = ownIn(registry.build, given, loads, host.report, { reactivity: host.reactivity, server: host.server, onCleanup: registry.onEnd })
          owns.set(registry, own)
          return own
        },
      }),
  }
}

/** `prop`'s Features and loads, every list flattened. */
const leavesOf = (prop: InstanceFeaturesProp): ReadonlyArray<Feature | FeatureLoad> =>
  Bool.match(Array.isArray(prop), {
    onTrue: () => Arr.flatMap(prop as ReadonlyArray<InstanceFeaturesProp>, leavesOf),
    onFalse: () => [prop as Feature | FeatureLoad],
  })

const isFeature = (leaf: Feature | FeatureLoad): leaf is Feature => Predicate.hasProperty(leaf, "layer")

const isLoad = (leaf: Feature | FeatureLoad): leaf is FeatureLoad => Predicate.isFunction(leaf)

/**
 * `load`, started at its first call, its promise kept for every call after. A failed load is forgotten,
 * so the next provider to ask loads again, as a new `LazyWardic` does.
 */
const once = (load: FeatureLoad): FeatureLoad => {
  let started: Promise<Features> | undefined
  return () =>
    UndefinedOr.match(started, {
      onDefined: identity,
      onUndefined: () => {
        const loading = load()
        started = loading
        loading.then(constVoid, () => {
          if (started === loading) started = undefined
        })
        return loading
      },
    })
}

/** A Wardic instance's Features in one provider: those given at once, and each load's, joined. */
const ownIn = (build: Build, given: ReadonlyArray<Feature>, loads: ReadonlyArray<FeatureLoad>, report: (cause: Cause.Cause<unknown>) => void, host: SectionHost): Own =>
  Arr.reduce(
    Arr.map(loads, (load) => ownOf(build, load, report, host)),
    ownOf(build, given, report, host),
    joinOwns,
  )
