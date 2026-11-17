/**
 * A **Wardic instance**'s Features (#516, ADR-0067 *Amendment (#516)*), for every binding: what
 * Solid's `createWardic` and Foldkit's `Wardic.make` split their list into, and what their elements take
 * in each provider: those given at once, flattened, each once, and each load (`() => import(…)`), started
 * once per instance the first time any provider asks, so one module's instance loads each once. In a
 * module only the makers import, apart from the spine every page shares, so an app with no Wardic
 * instance ships none of it (ADR-0067, *Amendment (#548)*).
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #793 (PR 1's review): solid's `instance-features.ts`, moved to dom for
// the Foldkit binding's loads (Q15).
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import { constVoid, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Feature from "./Feature.ts"

/**
 * `prop`'s Features (#516): those given at once, flattened, each once, and its loads, each started once,
 * the first time any provider asks, so one module's Wardic instance loads each once.
 */
export const instanceFeaturesOf = (prop: Feature.InstanceFeaturesProp): Feature.InstanceFeatures => {
  const leaves = leavesOf(prop)
  const given = Arr.dedupeWith(Arr.filter(leaves, isFeature), (a, b) => a === b)
  const loads = Arr.map(Arr.filter(leaves, isLoad), once)
  const owns = new WeakMap<Feature.FeatureRegistry, Feature.Own>()
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
const leavesOf = (prop: Feature.InstanceFeaturesProp): ReadonlyArray<Feature.Feature | Feature.FeatureLoad> =>
  Bool.match(Array.isArray(prop), {
    onTrue: () => Arr.flatMap(prop as ReadonlyArray<Feature.InstanceFeaturesProp>, leavesOf),
    onFalse: () => [prop as Feature.Feature | Feature.FeatureLoad],
  })

const isFeature = (leaf: Feature.Feature | Feature.FeatureLoad): leaf is Feature.Feature => Predicate.hasProperty(leaf, "layer")

const isLoad = (leaf: Feature.Feature | Feature.FeatureLoad): leaf is Feature.FeatureLoad => Predicate.isFunction(leaf)

/**
 * `load`, started at its first call, its promise kept for every call after. A failed load is forgotten,
 * so the next provider to ask loads again, as a new `LazyWardic` does.
 */
const once = (load: Feature.FeatureLoad): Feature.FeatureLoad => {
  let started: Promise<Feature.Features> | undefined
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
const ownIn = (build: Feature.Build, given: ReadonlyArray<Feature.Feature>, loads: ReadonlyArray<Feature.FeatureLoad>, report: (cause: Cause.Cause<unknown>) => void, host: Feature.SectionHost): Feature.Own =>
  Arr.reduce(
    Arr.map(loads, (load) => Feature.ownOf(build, load, report, host)),
    Feature.ownOf(build, given, report, host),
    Feature.joinOwns,
  )
