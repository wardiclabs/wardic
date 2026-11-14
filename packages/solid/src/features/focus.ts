/**
 * The **`focus` Feature** (#511, ADR-0067 decision 3): an element's focus as the browser shows it (`whileFocus`), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as Recognizer from "@wardic/core/Recognizer"
import type { Feature } from "../feature.ts"
import { FocusGesture } from "./keys.ts"
import { gestureLayer, withInput } from "./input.ts"

/** Focus gestures: `whileFocus`. */
export const focus: Feature<FocusGesture, FocusGesture["Service"], "focus"> = {
  name: "focus",
  key: FocusGesture,
  layer: /*#__PURE__*/ gestureLayer(FocusGesture, (source) => ({ watch: withInput(source, Recognizer.watchFocus) })),
}
