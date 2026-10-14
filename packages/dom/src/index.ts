/**
 * @wardic/dom — browser environment Layers.
 *
 * Provides the four browser realizations of core's contracts —
 * {@link ClockDomLive} (rAF-driven: the Clock and the Environment's `RefreshFrameSource`,
 * ADR-0031), {@link RendererDomLive} (style/transform
 * writes), {@link InputDomLive} (pointer/keyboard/wheel/focus), and
 * {@link ProbeDomLive} (`getBoundingClientRect` + Resize/Intersection
 * observers) — composed with core's real interpolator registry into the
 * {@link DomLive} Layer that apps provide to `WardicProvider`.
 *
 * And the framework-free pieces every binding shares: the flush gate ({@link makeFlushGate},
 * ADR-0006, ADR-0031), the projection engine (ADR-0009) and the server-render helpers
 * (ADR-0021).
 */
import type * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InputSource from "@wardic/core/InputSource"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Probe from "@wardic/core/Probe"
import type * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import { ClockDomLive } from "./clock.ts"
import { InputDomLive } from "./input.ts"
import { InterpolatorRegistryDomLive } from "./interpolators.ts"
import { PositionalKeysDomLive } from "./positional-keys.ts"
import { ProbeDomLive } from "./probe.ts"
import { RendererDomLive } from "./renderer.ts"

export const VERSION = "0.1.0-alpha.0"

export { ClockDomLive } from "./clock.ts"
export { InputDomLive } from "./input.ts"
// The DOM Environment's Positional keys (ADR-0036): the transforms and CSS's box keys.
export { isPositional, PositionalKeysDomLive } from "./positional-keys.ts"
// The DOM Environment's Key rules (ADR-0035): Tier 2. How a CSS property's pair blends by name
// (display / visibility, the Animatable none, shadow lists), and the registry DomLive provides.
export { animatableNone, keyRules, visibility } from "./key-rules.ts"
// The DOM Environment's Interpolators (ADR-0035, ADR-0036): core's, with CSS's colours (culori) as
// a tier and as a kind of token in the complex tier, CSS's var() as text there, and the registry
// DomLive provides.
export { type Color, color, COLOR_TOKEN, ColorString, cssColor } from "./colors.ts"
export { cssComplex, VARIABLE_REFERENCE } from "./complex.ts"
export { interpolators, InterpolatorRegistryDomLive } from "./interpolators.ts"
// Variable values (#55, ADR-0035 *Amendment (#55)*): Tier 2, for binding authors. The Key rule a
// binding binds to an element for each leg, with core's `InterpolatorRegistry.withKeyRules`.
export { isVariableValue, resolveVariable, variableValues } from "./variables.ts"
export { ProbeDomLive } from "./probe.ts"
export { ownOpacityOf, ownRotateOf, ownScaleOf, project, RendererDomLive } from "./renderer.ts"

// The flush gate (ADR-0006, ADR-0031) — framework-free; a binding builds one per provider with
// its own `batch`, and hands the inert gate to a server render (ADR-0021, decision 9).
export {
  type FlushGate,
  type FlushGateOptions,
  type FlushGateRuntime,
  type FlushSink,
  INERT_GATE,
  makeFlushGate,
} from "./gate.ts"

// Layout/projection engine (ADR-0009) — framework-agnostic; a binding wires it
// with its flush gate (as a ProjectionSink) + a runtime providing the Frame loop.
export { type AutoScroller, makeAutoScroller } from "./auto-scroll.ts"
export { DRAG_DEFAULT_ATTRIBUTES, type DragDefaultStyle, dragDefaultStyle, reorderTouchAction } from "./drag-defaults.ts"
export { measureLayoutBox } from "./measure.ts"
export {
  DEFAULT_DRAG_TRANSITION,
  DEFAULT_LAYOUT_TRANSITION,
  type DragProjectionHandle,
  type DragTransition,
  type LayoutTransition,
  makeProjectionSystem,
  type ProjectionNodeHandle,
  type ProjectionRuntime,
  type ProjectionSink,
  type ProjectionSystem,
  type ProjectionSystemOptions,
  type RegisterNodeOptions,
} from "./projection.ts"
// Where a binding's failure stops (ADR-0030, decision 4): logged at Error and reported to the
// Environment's ErrorReporters. Tier 2, for binding authors.
export { reportFailure } from "./report.ts"
// The Reorder group's controller (ADR-0020): the framework-free half of <Reorder>.
export {
  INERT_REORDER_CONTROLLER,
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
// first Frame, computed purely, the same on a server and on the client; and its fallback
// style after it, without the keys the flush gate holds (ADR-0034).
export {
  fallbackStyle,
  heldTouches,
  type InitialConfig,
  mergeStyle,
  resolveInitial,
  startingStyle,
  toValues,
} from "./starting-style.ts"
// Base values (ADR-0022): Tier 2, for binding authors. An element's Own value for a key (read
// once, at first need, on the client after mount) and the `style` link's lookup, for core's
// `BaseValue.of` / `BaseValue.start`.
export { type OwnValue, ownValues, styleValueOf, valueLike } from "./own-values.ts"

/**
 * The composed browser environment: the four DOM service Layers plus core's
 * {@link InterpolatorRegistry} with the DOM's Key rules (`InterpolatorRegistryDomLive`, ADR-0035)
 * and its Frame loop over the DOM Clock
 * (`FrameLoop.layer`, ADR-0027), fully self-contained (R = never). `ClockDomLive` also
 * provides the `RefreshFrameSource` the flush gate requests its flushes from (ADR-0031).
 *
 * `ProbeDomLive` requires the Environment's `AtomRegistry` (it writes the
 * `viewport`/`prefersReducedMotion` Atoms through it), and consumers read those same
 * Atoms through that registry — so `AtomRegistry` is
 * provided to them via `Layer.provideMerge` AND re-exposed in the output env,
 * exactly as the headless `testLayer` (packages/test) does. Provide this to
 * `WardicProvider` to run the full engine against the real DOM.
 *
 * Client-only: a server render builds no runtime, and building DomLive on a server fails
 * with a clear error naming the Layer and the missing global (ADR-0021, decision 7).
 */
export const DomLive: Layer.Layer<
  | Clock.Clock
  | RefreshFrameSource.RefreshFrameSource
  | FrameLoop.FrameLoop
  | Renderer.Renderer
  | InputSource.InputSource
  | Probe.Probe
  | InterpolatorRegistry.InterpolatorRegistry
  | ReducedMotion.PositionalKeys
  | AtomRegistry.AtomRegistry
> = FrameLoop.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(ClockDomLive, RendererDomLive, InputDomLive, ProbeDomLive, InterpolatorRegistryDomLive, PositionalKeysDomLive),
  ),
  Layer.provideMerge(AtomRegistry.layer),
)
