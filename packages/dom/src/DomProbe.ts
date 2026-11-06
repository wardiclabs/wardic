/**
 * The DOM's Probe: boxes from `getBoundingClientRect`, sizes and visibility from the observers, the
 * viewport, the reduced-motion preference from `matchMedia`, and whether the page is shown. `layer` needs
 * the Environment's `AtomRegistry`, which it writes its live values through; `DomLive` provides both. A
 * container's scroll is `DomScrollSource`'s.
 *
 * @example
 * import * as DomProbe from "@wardic/dom/DomProbe"
 *
 * const probe = DomProbe.layer.pipe(Layer.provide(AtomRegistry.layer))
 */
// `@wardic/dom/DomProbe` (#132, ADR-0041).
export {
  ProbeDomLive as layer,
} from "./internal/probe.ts"
