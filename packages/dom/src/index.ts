/**
 * @wardic/dom — browser environment Layers.
 *
 * Provides the four browser realizations of core's contracts —
 * {@link ClockDomLive} (rAF-driven), {@link RendererDomLive} (style/transform
 * writes), {@link InputDomLive} (pointer/keyboard/wheel/focus), and
 * {@link ProbeDomLive} (`getBoundingClientRect` + Resize/Intersection
 * observers) — composed with core's real interpolator registry into the
 * {@link DomLive} Layer that apps provide to `WardicProvider`.
 */
import { InterpolatorRegistryLive } from "@wardic/core"
import type { Clock, InputSource, InterpolatorRegistry, Probe, Renderer } from "@wardic/core"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/unstable/reactivity"
import { ClockDomLive } from "./clock.ts"
import { InputDomLive } from "./input.ts"
import { ProbeDomLive } from "./probe.ts"
import { RendererDomLive } from "./renderer.ts"

export const VERSION = "0.1.0-alpha.0"

export { ClockDomLive } from "./clock.ts"
export { InputDomLive } from "./input.ts"
export { ProbeDomLive } from "./probe.ts"
export { RendererDomLive } from "./renderer.ts"

/**
 * The composed browser environment: the four DOM service Layers plus core's
 * real {@link InterpolatorRegistry}, fully self-contained (R = never).
 *
 * `ClockDomLive`/`ProbeDomLive` require the Environment's `AtomRegistry` (they
 * write `time`/`dt` and `viewport`/`prefersReducedMotion` Atoms through it), and
 * consumers read those same Atoms through that registry — so `AtomRegistry` is
 * provided to them via `Layer.provideMerge` AND re-exposed in the output env,
 * exactly as the headless `testLayer` (packages/test) does. Provide this to
 * `WardicProvider` to run the full engine against the real DOM.
 */
export const DomLive: Layer.Layer<
  Clock | Renderer | InputSource | Probe | InterpolatorRegistry | AtomRegistry.AtomRegistry
> = Layer.mergeAll(
  ClockDomLive,
  RendererDomLive,
  InputDomLive,
  ProbeDomLive,
  InterpolatorRegistryLive,
).pipe(Layer.provideMerge(AtomRegistry.layer))
