/**
 * The **Projection system**: the DOM's engine for the **Projection**, one per Environment a binding builds. It holds every Projection node, runs the Measure pass and the per-frame projection pass, and owns `layoutId` matching (ADR-0009, ADR-0010, ADR-0018).
 *
 * `@wardic/dom/ProjectionSystem` (#132, ADR-0041).
 */
export {
  makeProjectionSystem as make,
  type ProjectionSystem,
  type ProjectionSystemOptions as Options,
  type ProjectionRuntime as Runtime,
  type ProjectionSink as Sink,
  type RegisterNodeOptions,
  type ProjectionNodeHandle as NodeHandle,
  type DragProjectionHandle as DragHandle,
  type AnimateLayoutOptions,
  type LayoutTransition,
  type DragTransition,
  DEFAULT_LAYOUT_TRANSITION,
  DEFAULT_DRAG_TRANSITION,
} from "./internal/projection.ts"
export { measureLayoutBox } from "./internal/measure.ts"
