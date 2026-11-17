/**
 * **Drag controls** on Foldkit (#431, Motion's `useDragControls`; #793, Q8): made apart from any element
 * with {@link make}, at module scope or in the Model's making, and given to a `w.*` element as
 * `w.DragControls(controls)`. Its drag then starts from a pointer pressed on the `StartsDrag` element
 * (`w.StartsDrag(controls, options)`), or from `controls.start(event)` wherever a pointer went down;
 * `controls.stop()` ends each drag as a release would, `controls.cancel()` where it is. Add
 * `w.DragListener(false)` when a press on the element itself shouldn't drag it.
 *
 * @example
 * const controls = DragControls.make()
 * w.div([w.Drag("y"), w.DragControls(controls), w.DragListener(false)], [
 *   w.div([w.StartsDrag(controls), h.Style({ "touch-action": "none" })], ["⋮⋮"]),
 *   "a row dragged by its grip",
 * ])
 *
 * @module
 */
import * as DomControls from "@wardic/dom/unstable/DragControls"

/** The controls: `start(event, options?)`, `stop()` and `cancel()`, over every element given them. */
export type DragControls = DomControls.WardicDragControls

/** `start`'s options (Motion's): `snapToCursor` moves the element's centre under the pointer as the drag begins; `distanceThreshold` is how far it moves first, 3 px by default. */
export type StartOptions = DomControls.WardicDragControlsOptions

/** Makes drag controls (Motion's `useDragControls`): needs no element, and outlives the elements given them. */
export const make: () => DragControls = DomControls.createDragControls
