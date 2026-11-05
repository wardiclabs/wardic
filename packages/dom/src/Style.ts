/**
 * An element's style as a binding builds it: its starting style, what it's drawn with before any
 * animation runs, from its `initial` (or its `animate`, with `initial: false`); how an app's own style and
 * Wardic's are layered (`over`, `without`); and a drag element's default style. A server render draws the
 * starting style, so an element is drawn where it starts before any code runs.
 *
 * @example
 * import * as Style from "@wardic/dom/Style"
 *
 * const start = Style.resolveInitial({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } })
 * Style.starting(undefined, start) // { style: { transform: "translateY(8px)", opacity: 0 }, attrs: {} }
 */
// `@wardic/dom/Style` (#132, ADR-0041): the **Starting style**, the merges of an app's style with
// Wardic's, and a drag element's defaults (ADR-0019, ADR-0021, ADR-0034).
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
