/**
 * The **`pan` Feature** (#511, ADR-0067 decision 3): an element's pan (`onPan`, `onPanStart`, `onPanSessionStart`, `onPanEnd`; Solid 2's `"pan"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/pan.ts`, moved to dom with the Features, for
// every DOM binding.
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as Feature from "../Feature.ts"
import * as Keys from "./Keys.ts"
import * as Input from "./Input.ts"

/** Pan gestures: the pan callbacks. */
export const pan: Feature.Feature<Keys.PanGesture, Keys.PanGesture["Service"], "pan"> = {
  name: "pan",
  key: Keys.PanGesture,
  layer: /*#__PURE__*/ Input.gestureLayer(Keys.PanGesture, (source) => ({ watch: Input.withInput(source, DragRecognizer.watchPan) })),
}
