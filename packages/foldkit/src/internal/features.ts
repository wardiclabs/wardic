/**
 * A Handle's Features in a provider (#516; #793, Q2 and Q15): those given at once, flattened, built on
 * first need, and each load (`() => import(…)`), started as the provider builds, on the client, and
 * built as it arrives, from then on, until the provider ends; `pending` while any is on its way. A
 * failed load is reported, once. A provider that builds again (the last element left, a new one
 * mounted) calls each load again, and `import()` answers from the browser's module cache.
 *
 * @module
 */
import * as Feature from "@wardic/dom/unstable/Feature"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import * as Predicate from "effect/Predicate"

/** `prop`'s Features and loads, every list flattened. */
const leavesOf = (prop: Feature.InstanceFeaturesProp): ReadonlyArray<Feature.Feature | Feature.FeatureLoad> =>
  Bool.match(Arr.isArray(prop), {
    onTrue: () => Arr.flatMap(prop as ReadonlyArray<Feature.InstanceFeaturesProp>, leavesOf),
    onFalse: () => [prop as Feature.Feature | Feature.FeatureLoad],
  })

const isFeature = (leaf: Feature.Feature | Feature.FeatureLoad): leaf is Feature.Feature => Predicate.hasProperty(leaf, "layer")

const isLoad = (leaf: Feature.Feature | Feature.FeatureLoad): leaf is Feature.FeatureLoad => Predicate.isFunction(leaf)

/**
 * A provider's own Features from `prop` (above): the given ones, each once, and each load's, joined;
 * none without a prop. `host`'s trigger tells the arrivals.
 */
export const ownOf = (prop: Feature.InstanceFeaturesProp | undefined, build: Feature.Build, report: (cause: Cause.Cause<unknown>) => void, host: Feature.SectionHost): Feature.Own => {
  if (Predicate.isUndefined(prop)) return Feature.ownOf(build, undefined, report, host)
  const leaves = leavesOf(prop)
  const given = Arr.dedupeWith(Arr.filter(leaves, isFeature), (a, b) => a === b)
  return Arr.reduce(
    Arr.map(Arr.filter(leaves, isLoad), (load) => Feature.ownOf(build, load, report, host)),
    Feature.ownOf(build, given, report, host),
    Feature.joinOwns,
  )
}
