/**
 * The **`press` Feature** (#511, ADR-0067 decision 3): an element's press, its Keyboard presses included (`whileTap`, `onTap…`; Solid 2's `"tap"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import type { Feature } from "../feature.ts"
import { PressGesture } from "./keys.ts"
import { watchPressOn } from "../press.ts"
import { gestureLayer, withInput } from "./input.ts"

/** Press gestures, a pointer's and the keyboard's: `whileTap` and the tap callbacks. */
export const press: Feature<PressGesture, PressGesture["Service"]> = {
  name: "press",
  key: PressGesture,
  layer: /*#__PURE__*/ gestureLayer(PressGesture, (source) => ({ watch: withInput(source, watchPressOn) })),
}
