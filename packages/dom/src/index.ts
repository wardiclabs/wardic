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
export { project, RendererDomLive } from "./renderer.ts"

// Layout/projection engine (ADR-0009) — framework-agnostic; a binding wires it
// with its own flush gate (as a ProjectionSink) + a runtime providing Clock.
export { type AutoScroller, makeAutoScroller } from "./auto-scroll.ts"
export { DRAG_DEFAULT_ATTRIBUTES, type DragDefaultStyle, dragDefaultStyle, reorderTouchAction } from "./drag-defaults.ts"
export { measureLayoutBox } from "./measure.ts"
export {
  type DragProjectionHandle,
  makeProjectionSystem,
  type ProjectionNodeHandle,
  type ProjectionRuntime,
  type ProjectionSink,
  type ProjectionSystem,
  type RegisterNodeOptions,
} from "./projection.ts"
// The Reorder group's controller (ADR-0020): the framework-free half of <Reorder>.
export {
  makeReorderController,
  REORDER_GROUP_STYLE,
  type ReorderController,
  type ReorderControllerOptions,
  type ReorderItemDriver,
} from "./reorder.ts"
// Scale-correction registry (ADR-0011) — borderRadius/boxShadow visual correction.
export {
  borderRadiusCorrector,
  boxShadowCorrector,
  type ScaleCorrector,
  SCALE_CORRECTORS,
} from "./scale-correction.ts"
// SVG attribute/style routing (ADR-0014) — the binding's signal-sink applies the
// `style` half declaratively + the `attrs` half via `setSvgAttrs`. The by-tag forms route
// where there is no element yet (a server render, the Starting style; ADR-0021).
export {
  dashCase,
  isSvgInner,
  isSvgInnerTag,
  isSvgRoot,
  setSvgAttrs,
  type SplitPatch,
  splitPatch,
  splitPatchForTag,
} from "./svg.ts"
// Starting style (ADR-0021): Tier 2, for binding authors. An element's style before its
// first Frame, computed purely, the same on a server and on the client.
export { type InitialConfig, mergeStyle, resolveInitial, startingStyle, toValues } from "./starting-style.ts"

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
 *
 * Client-only: a server render builds no runtime, and building DomLive on a server fails
 * with a clear error naming the Layer and the missing global (ADR-0021, decision 7).
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
