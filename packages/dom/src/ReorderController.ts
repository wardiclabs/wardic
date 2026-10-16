/**
 * A **Reorder group**'s controller in the DOM: the group, its drag, its keyboard and its announcements (ADR-0019 *Amendment (Reorder)*, ADR-0037). A server render gets `inert` (ADR-0021).
 *
 * `@wardic/dom/ReorderController` (#132, ADR-0041).
 */
export {
  makeReorderController as make,
  INERT_REORDER_CONTROLLER as inert,
  type ReorderController,
  type ReorderControllerOptions as Options,
  type ReorderItemDriver as ItemDriver,
  DEFAULT_REORDER_INSTRUCTIONS as DEFAULT_INSTRUCTIONS,
  REORDER_GROUP_STYLE as GROUP_STYLE,
} from "./internal/reorder.ts"
