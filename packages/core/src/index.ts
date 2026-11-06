/**
 * @wardic/core — the framework-agnostic animation engine, one module per data type or term of
 * Wardic's glossary, and Effect-typed. The root re-exports each module as a namespace, for a user who
 * writes `import { Machine } from "@wardic/core"`; code in the repo imports the subpath,
 * `import * as Machine from "@wardic/core/Machine"`.
 *
 * Each Primitive is a machine (`Machine`), run as a `Stream` over the Clock's ticks
 * (`Machine.toStream`) or on the Frame loop (`Machine.run`). The services (`Clock`,
 * `RefreshFrameSource`, `Renderer`, `InputSource`, `Probe`, `InterpolatorRegistry`, `FrameLoop`,
 * `DefaultTransition`) are each `X.X`, with the shared constructors the Environments build on
 * (`Clock.layer`, `Clock.fromRefreshFrames`, `InputSource.heldPointer`, `InputFeed.byTarget`,
 * `InterpolatorRegistry.layer`, `FrameLoop.layer`, `DefaultTransition.layerOneSpring`). Each module's
 * page is at https://wardic.dev/reference/core.
 */
// A module per data type or CONTEXT.md term: ADR-0028. Primitives as machines, run as Streams or on
// the Frame loop: ADR-0001, ADR-0027. Design decisions and the glossary: `docs/adr/` and `CONTEXT.md`.
export * as Announcer from "./Announcer.ts"
export * as Arc from "./Arc.ts"
export * as AutoScroll from "./AutoScroll.ts"
export * as BaseValue from "./BaseValue.ts"
export * as Box from "./Box.ts"
export * as Clock from "./Clock.ts"
export * as DefaultTransition from "./DefaultTransition.ts"
export * as Drag from "./Drag.ts"
export * as DragActivity from "./DragActivity.ts"
export * as DragRecognizer from "./DragRecognizer.ts"
export * as Easing from "./Easing.ts"
export * as Frame from "./Frame.ts"
export * as FrameLoop from "./FrameLoop.ts"
export * as Inertia from "./Inertia.ts"
export * as InputFeed from "./InputFeed.ts"
export * as InputSource from "./InputSource.ts"
export * as Interpolator from "./Interpolator.ts"
export * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
export * as LiveValue from "./LiveValue.ts"
export * as Machine from "./Machine.ts"
export * as Microtask from "./Microtask.ts"
export * as Override from "./Override.ts"
export * as Playback from "./Playback.ts"
export * as Point from "./Point.ts"
export * as PressClaims from "./PressClaims.ts"
export * as Probe from "./Probe.ts"
export * as Projection from "./Projection.ts"
export * as Recognizer from "./Recognizer.ts"
export * as ReducedMotion from "./ReducedMotion.ts"
export * as RefreshFrameSource from "./RefreshFrameSource.ts"
export * as Renderer from "./Renderer.ts"
export * as Reorder from "./Reorder.ts"
export * as Scalar from "./Scalar.ts"
export * as Sequence from "./Sequence.ts"
export * as SharedSource from "./SharedSource.ts"
export * as Spring from "./Spring.ts"
export * as Stagger from "./Stagger.ts"
export * as Supersede from "./Supersede.ts"
export * as Values from "./Values.ts"
export * as Velocity from "./Velocity.ts"
export * as Wave from "./Wave.ts"
