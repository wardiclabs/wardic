/**
 * The **`hover` Feature** (#511, ADR-0067 decision 3): an element's hover (`whileHover`, `onHoverStart`, `onHoverEnd`; Solid 2's `"hover"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as Recognizer from "@wardic/core/Recognizer"
import type { Feature } from "../feature.ts"
import { HoverGesture } from "./keys.ts"
import { gestureLayer, withInput } from "./input.ts"

/** Hover gestures: `whileHover` and the hover callbacks. */
export const hover: Feature<HoverGesture, HoverGesture["Service"], "hover"> = {
  name: "hover",
  key: HoverGesture,
  layer: /*#__PURE__*/ gestureLayer(HoverGesture, (source) => ({ watch: withInput(source, Recognizer.watchHover) })),
}
