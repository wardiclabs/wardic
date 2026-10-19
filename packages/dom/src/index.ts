/**
 * `@wardic/dom`: the browser Environment, and the framework-free pieces a binding builds on (#132,
 * ADR-0041). It's for binding authors (ADR-0008 Tier 2): Wardic's own, and any other.
 *
 * - **An app** imports {@link DomLive}, the composed Environment it hands its binding.
 * - **A binding** imports each module by its subpath, as a namespace
 *   (`import * as FlushGate from "@wardic/dom/FlushGate"`), and the root re-exports each one:
 *   - the DOM's implementations of core's services, each with its `layer` (Effect's platform
 *     convention: `DomRenderer`, `DomInput`, `DomProbe`, `DomClock`, `DomAnnouncer`,
 *     `DomInterpolators`, `DomPositionalKeys`, `DomKeyRules`);
 *   - dom's own concepts, by the glossary's names: `FlushGate`, `ProjectionSystem`,
 *     `ReorderController`, `Style`, `Svg`, `Color`, `Variables`, `ScrollOffset`, `Appear`, `OwnValues`
 *     and `Report`.
 *
 * Everything under `internal/` is dom's own and not exported.
 */
import type * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InputSource from "@wardic/core/InputSource"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Announcer from "@wardic/core/Announcer"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Probe from "@wardic/core/Probe"
import type * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as DomAnnouncer from "./DomAnnouncer.ts"
import * as DomClock from "./DomClock.ts"
import * as DomInput from "./DomInput.ts"
import * as DomInterpolators from "./DomInterpolators.ts"
import * as DomPositionalKeys from "./DomPositionalKeys.ts"
import * as DomProbe from "./DomProbe.ts"
import * as DomRenderer from "./DomRenderer.ts"

export const VERSION = "0.1.0-alpha.0"

export * as DomClock from "./DomClock.ts"
export * as DomInput from "./DomInput.ts"
export * as DomProbe from "./DomProbe.ts"
export * as DomRenderer from "./DomRenderer.ts"
export * as DomAnnouncer from "./DomAnnouncer.ts"
export * as DomInterpolators from "./DomInterpolators.ts"
export * as DomPositionalKeys from "./DomPositionalKeys.ts"
export * as DomKeyRules from "./DomKeyRules.ts"
export * as FlushGate from "./FlushGate.ts"
export * as ProjectionSystem from "./ProjectionSystem.ts"
export * as ReorderController from "./ReorderController.ts"
export * as Style from "./Style.ts"
export * as Svg from "./Svg.ts"
export * as Color from "./Color.ts"
export * as Variables from "./Variables.ts"
export * as ScrollOffset from "./ScrollOffset.ts"
export * as Appear from "./Appear.ts"
export * as OwnValues from "./OwnValues.ts"
export * as Report from "./Report.ts"

/**
 * The composed browser environment: the DOM's service Layers plus core's
 * {@link InterpolatorRegistry} with the DOM's Key rules (`DomInterpolators.layer`, ADR-0035)
 * and its Frame loop over the DOM Clock
 * (`FrameLoop.layer`, ADR-0027), fully self-contained (R = never). `DomClock.layer` also
 * provides the `RefreshFrameSource` the flush gate requests its flushes from (ADR-0031).
 *
 * `DomProbe.layer` requires the Environment's `AtomRegistry` (it writes the
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
  | Announcer.Announcer
  | AtomRegistry.AtomRegistry
> = FrameLoop.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(DomClock.layer, DomRenderer.layer, DomInput.layer, DomProbe.layer, DomInterpolators.layer, DomPositionalKeys.layer, DomAnnouncer.layer),
  ),
  Layer.provideMerge(AtomRegistry.layer),
)
