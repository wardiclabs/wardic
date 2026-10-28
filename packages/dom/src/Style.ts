/**
 * An element's style as a binding builds it: the **Starting style**, the merges of an app's style with Wardic's, and a drag element's defaults (ADR-0019, ADR-0021, ADR-0034).
 *
 * `@wardic/dom/Style` (#132, ADR-0041).
 */
export {
  startingStyle as starting,
  resolveInitial,
  type InitialConfig,
  keyframesOf,
  splitValues,
  type SplitValues,
  type StopAt,
  type Stops,
  toValues,
  valuesAt,
  type StyleInput as Input,
  type StyleRecord as Style,
  over,
  without,
  heldTouches,
} from "./internal/starting-style.ts"
export {
  dragDefaultStyle as dragDefaults,
  type DragDefaultStyle as DragDefaults,
  DRAG_DEFAULT_ATTRIBUTES,
  reorderTouchAction,
} from "./internal/drag-defaults.ts"
