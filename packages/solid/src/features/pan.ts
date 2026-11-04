/**
 * The **`pan` Feature** (#511, ADR-0067 decision 3): an element's pan (`onPan`, `onPanStart`, `onPanSessionStart`, `onPanEnd`; Solid 2's `"pan"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import type { Feature } from "../feature.ts"
import { PanGesture } from "./keys.ts"
import { gestureLayer, withInput } from "./input.ts"

/** Pan gestures: the pan callbacks. */
export const pan: Feature<PanGesture, PanGesture["Service"]> = {
  name: "pan",
  key: PanGesture,
  layer: /*#__PURE__*/ gestureLayer(PanGesture, (source) => ({ watch: withInput(source, DragRecognizer.watchPan) })),
}
