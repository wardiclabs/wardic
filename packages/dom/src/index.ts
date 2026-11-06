/**
 * `@wardic/dom`: the browser Environment, and the framework-free pieces a binding builds on. It's for
 * binding authors, Wardic's own and any other, and it's Effect-typed.
 *
 * - **An app** imports {@link DomLive}, the composed Environment it hands its binding, and
 *   {@link CheckFrames}, to check its Frames in development.
 * - **A binding** imports each module by its subpath, as a namespace
 *   (`import * as FlushGate from "@wardic/dom/FlushGate"`), and the root re-exports each one:
 *   - the DOM's implementations of core's services, each with its `layer` (Effect's platform
 *     convention: `DomRenderer`, `DomInput`, `DomProbe`, `DomClock`, `DomAnnouncer`,
 *     `DomInterpolators`, `DomPositionalKeys`, `DomDefaultTransition`), and `DomKeyRules`, the Key
 *     rules `DomInterpolators.layer` installs, which has none of its own;
 *   - dom's own concepts, by the glossary's names: `FlushGate`, `ProjectionSystem`,
 *     `ReorderController`, `Style`, `Svg`, `Color`, `Variables`, `ScrollOffset`, `Appear`, `OwnValues`
 *     and `Report`.
 *
 * Everything under `internal/` is dom's own and not exported.
 */
// `@wardic/dom` (#132, ADR-0041), Tier 2 (ADR-0008); CheckFrames re-exported for an app (#586).
import type * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Announcer from "@wardic/core/Announcer"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Probe from "@wardic/core/Probe"
import type * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as DomAnnouncer from "./DomAnnouncer.ts"
import * as DomClock from "./DomClock.ts"
import * as DomDefaultTransition from "./DomDefaultTransition.ts"
import * as DomInterpolators from "./DomInterpolators.ts"
import * as DomPositionalKeys from "./DomPositionalKeys.ts"
import * as DomProbe from "./DomProbe.ts"
import * as DomRenderer from "./DomRenderer.ts"

export const VERSION = "1.0.0-rc.3"

export * as DomClock from "./DomClock.ts"
export * as DomInput from "./DomInput.ts"
export * as DomProbe from "./DomProbe.ts"
export * as DomRenderer from "./DomRenderer.ts"
export * as DomAnnouncer from "./DomAnnouncer.ts"
export * as DomInterpolators from "./DomInterpolators.ts"
export * as DomPositionalKeys from "./DomPositionalKeys.ts"
export * as DomDefaultTransition from "./DomDefaultTransition.ts"
export * as DomKeyRules from "./DomKeyRules.ts"
export * as FlushGate from "./FlushGate.ts"
export * as ProjectionSystem from "./ProjectionSystem.ts"
export * as DomProjectionSystem from "./DomProjectionSystem.ts"
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
 * Core's development check for Frames that aren't finite (`FrameLoop.CheckFrames`), here for an app,
 * which installs `@wardic/dom` and not `@wardic/core`. Off by default; merged beside {@link DomLive} as
 * `Layer.succeed(CheckFrames, true)`, it fails an animation whose Frame holds a NaN or an Infinity,
 * naming its key and value, where the page would drop it without a word. It checks every Frame, so
 * it's for development: see https://wardic.dev/guides/observability.
 */
// ADR-0030 decision 7; re-exported here for an app (#586).
export { CheckFrames } from "@wardic/core/FrameLoop"

/**
 * The browser Environment, composed: the DOM's services, core's interpolators with the DOM's Key
 * rules, and the Frame loop over the DOM's Clock, needing nothing else. Hand it to `WardicProvider`'s
 * `env` to run the engine on the page.
 *
 * It has no input: a binding's gestures build `DomInput.layer` with the first one an app uses, so an
 * app with none ships no input code.
 *
 * Client-only: a server render builds no runtime, and building DomLive on a server fails with an
 * error naming the service and the missing global: see https://wardic.dev/guides/server-rendering.
 */
// Key rules: ADR-0035. Frame loop: ADR-0027. `DomClock.layer` also provides the `RefreshFrameSource`
// the flush gate requests its flushes from (ADR-0031). `DomProbe.layer` writes the `viewport` and
// `prefersReducedMotion` Atoms through the Environment's `AtomRegistry`, and consumers read them
// through the same registry, so `AtomRegistry` is provided to the Layers with `Layer.provideMerge` and
// kept in the output, as the headless `testLayer` (packages/test) does: R = never. No InputSource:
// #511, ADR-0067 decision 14. Client-only: ADR-0021, decision 7.
export const DomLive: Layer.Layer<
  | Clock.Clock
  | RefreshFrameSource.RefreshFrameSource
  | FrameLoop.FrameLoop
  | Renderer.Renderer
  | Probe.Probe
  | InterpolatorRegistry.InterpolatorRegistry
  | ReducedMotion.PositionalKeys
  | DefaultTransition.DefaultTransition
  | Announcer.Announcer
  | AtomRegistry.AtomRegistry
> = FrameLoop.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(DomClock.layer, DomRenderer.layer, DomProbe.layer, DomInterpolators.layer, DomPositionalKeys.layer, DomDefaultTransition.layer, DomAnnouncer.layer),
  ),
  Layer.provideMerge(AtomRegistry.layer),
)
