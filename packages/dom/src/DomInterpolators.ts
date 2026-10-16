/**
 * The DOM's `InterpolatorRegistry`: core's Interpolators with the DOM's colours and complex values, and its Key rules (ADR-0024, ADR-0035, ADR-0036).
 *
 * `@wardic/dom/DomInterpolators` (#132, ADR-0041).
 */
export {
  InterpolatorRegistryDomLive as layer,
  interpolators as all,
} from "./internal/interpolators.ts"
