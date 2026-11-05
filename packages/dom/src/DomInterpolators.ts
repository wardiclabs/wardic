/**
 * The DOM's InterpolatorRegistry: core's value kinds with the DOM's colours and complex values, and the
 * DOM's Key rules. `layer` is what `DomLive` provides; `all` is its kinds, in the order they're tried.
 *
 * @example
 * import * as DomInterpolators from "@wardic/dom/DomInterpolators"
 *
 * const registry = yield* InterpolatorRegistry.make(DomInterpolators.all, DomKeyRules.all)
 * const blend = yield* registry.resolve("#bf616a", "#a3be8c")
 * blend(0.5) // the colour halfway
 */
// `@wardic/dom/DomInterpolators` (#132, ADR-0041): ADR-0024, ADR-0035, ADR-0036.
export {
  InterpolatorRegistryDomLive as layer,
  interpolators as all,
} from "./internal/interpolators.ts"
