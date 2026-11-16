/**
 * The **`focus` Feature** (#511, ADR-0067 decision 3): an element's focus as the browser shows it (`whileFocus`), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/focus.ts`, moved to dom with the Features, for
// every DOM binding.
import * as Recognizer from "@wardic/core/Recognizer"
import type * as Feature from "../Feature.ts"
import * as Keys from "./Keys.ts"
import * as Input from "./Input.ts"

/** Focus gestures: `whileFocus`. */
export const focus: Feature.Feature<Keys.FocusGesture, Keys.FocusGesture["Service"], "focus"> = {
  name: "focus",
  key: Keys.FocusGesture,
  layer: /*#__PURE__*/ Input.gestureLayer(Keys.FocusGesture, (source) => ({ watch: Input.withInput(source, Recognizer.watchFocus) })),
}
