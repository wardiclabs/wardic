/**
 * The **Projection system**: the DOM's engine for the **Projection**, one per Environment a binding
 * builds. It holds every Projection node, runs the Measure pass and the per-frame projection pass,
 * and owns `layoutId` matching (ADR-0009, ADR-0010, ADR-0018). `@wardic/dom/ProjectionSystem`
 * (#132, ADR-0041).
 *
 * This module is its key and its types (#548): every element's code looks the key up, so the engine
 * itself, `make` and `layer`, is `DomProjectionSystem`'s, which only a binding's `layout` Feature
 * imports. A page that never lays out ships none of it (ADR-0067, *Amendment (#548)*).
 *
 * It's an Effect `Inspectable` (#384): `toJSON()` gives the tree as plain data ({@link Snapshot}),
 * each node with its parent, its `layoutId` twin's part and what it's doing, and
 * `console.log(system)` shows it. It's a diagnostic read: the layout lab draws it.
 *
 * A server render builds none (ADR-0021).
 */
import * as Context from "effect/Context"
import type * as internal from "./internal/projection.ts"

export {
  type RegisterNodeOptions,
  type ProjectionNodeHandle as NodeHandle,
  type DragProjectionHandle as DragHandle,
  type AnimateLayoutOptions,
  type Snapshot,
  type NodeSnapshot,
} from "./internal/projection.ts"
export { DEFAULT_DRAG_TRANSITION, DEFAULT_LAYOUT_TRANSITION, type DragTransition, type LayoutTransition } from "./internal/projection-defaults.ts"
export type { ScaleCorrectorEntry as ScaleCorrector, CorrectorInfo } from "./internal/scale-correction.ts"
export { dragBoundsWithin, measureLayoutBox } from "./internal/measure.ts"

/** The engine: what a binding registers its layout elements with. */
export type Shape = Omit<internal.ProjectionSystem, "dispose">

/** What the engine writes each node's projection through: a `FlushGate`'s `write` and `flushPass`. */
export type Sink = internal.ProjectionSink

/** What a binding hands its engine: whether reduced motion applies now (ADR-0029), and the app's scale correctors (#443). */
export type Options = internal.ProjectionSystemOptions

/** The services the engine needs from its Environment. */
export type Services = internal.ProjectionServices

/** The Environment's Projection system. */
export class ProjectionSystem extends /*#__PURE__*/ Context.Service<ProjectionSystem, Shape>()("@wardic/dom/ProjectionSystem") {}
