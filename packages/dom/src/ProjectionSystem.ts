/**
 * The Projection system: what runs the DOM's layout animations, one per Environment a binding builds. A binding registers
 * each layout element with it, and when a layout changes it measures their boxes, draws each where it was
 * with a transform, and animates it to where it is now; elements that share a `layoutId` fly one into the
 * other. This module is its key and its types, which every element's code reads: the engine itself is
 * `DomProjectionSystem`'s, so a page that never lays out ships none of it. `toJSON()` gives its tree as
 * plain data, for a diagnostic view. A server render builds none.
 *
 * @example
 * import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
 *
 * const system = yield* ProjectionSystem.ProjectionSystem
 * const node = system.register({ id: "card", element: card, transition: () => Option.none() })
 * system.animateLayout(() => expand(card)) // measured before and after, and animated between
 */
// The **Projection system**, the DOM's engine for the **Projection** (ADR-0009, ADR-0010, ADR-0018): it
// holds every Projection node, runs the Measure pass and the per-frame projection pass, and owns `layoutId`
// matching. `@wardic/dom/ProjectionSystem` (#132, ADR-0041). The key apart from the engine: #548, ADR-0067
// *Amendment (#548)*. An Effect `Inspectable` (#384): `console.log(system)` shows the tree, as `Tree`,
// each node with its parent, its `layoutId` twin's part and what it's doing; the layout lab draws it. A
// server render builds none (ADR-0021).
import * as Context from "effect/Context"
import type * as internal from "./internal/projection.ts"

export {
  type RegisterNodeOptions,
  type ProjectionNodeHandle as NodeHandle,
  type DragProjectionHandle as DragHandle,
  type AnimateLayoutOptions,
  type Tree,
  type TreeNode,
} from "./internal/projection.ts"
export { DEFAULT_DRAG_TRANSITION, DEFAULT_LAYOUT_TRANSITION, type DragTransition, type LayoutTransition } from "./internal/projection-defaults.ts"
export type { ScaleCorrectorEntry as ScaleCorrector, CorrectorInfo } from "./internal/scale-correction.ts"
export { dragBoundsWithin, measureLayoutBox } from "./internal/measure.ts"

/** The engine: what a binding registers its layout elements with. */
export type Shape = Omit<internal.ProjectionSystem, "dispose" | "onPassEnd">

/** What the engine writes each node's projection through: a `FlushGate`'s `write` and `flushPass`. */
export type Sink = internal.ProjectionSink

/** What a binding hands its engine: whether reduced motion applies now, and the app's scale correctors. */
// ADR-0029; #443.
export type Options = internal.ProjectionSystemOptions

/** The services the engine needs from its Environment. */
export type Services = internal.ProjectionServices

/** The Environment's Projection system. */
export class ProjectionSystem extends /*#__PURE__*/ Context.Service<ProjectionSystem, Shape>()("@wardic/dom/ProjectionSystem") {}
