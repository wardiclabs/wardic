/**
 * The **`press` Feature** (#511, ADR-0067 decision 3): an element's press, its Keyboard presses included (`whileTap`, `onTap…`; Solid 2's `"tap"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/press.ts`, moved to dom with the Features, for
// every DOM binding.
import type * as Feature from "../Feature.ts"
import * as Keys from "./Keys.ts"
import * as Press from "../Press.ts"
import * as Input from "./Input.ts"

/** Press gestures, a pointer's and the keyboard's: `whileTap` and the tap callbacks. */
export const press: Feature.Feature<Keys.PressGesture, Keys.PressGesture["Service"], "press"> = {
  name: "press",
  key: Keys.PressGesture,
  layer: /*#__PURE__*/ Input.gestureLayer(Keys.PressGesture, (source) => ({ watch: Input.withInput(source, Press.watchPressOn) })),
}
