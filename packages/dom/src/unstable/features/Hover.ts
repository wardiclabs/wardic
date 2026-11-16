/**
 * The **`hover` Feature** (#511, ADR-0067 decision 3): an element's hover (`whileHover`, `onHoverStart`, `onHoverEnd`; Solid 2's `"hover"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/hover.ts`, moved to dom with the Features, for
// every DOM binding.
import * as Recognizer from "@wardic/core/Recognizer"
import type * as Feature from "../Feature.ts"
import * as Keys from "./Keys.ts"
import * as Input from "./Input.ts"

/** Hover gestures: `whileHover` and the hover callbacks. */
export const hover: Feature.Feature<Keys.HoverGesture, Keys.HoverGesture["Service"], "hover"> = {
  name: "hover",
  key: Keys.HoverGesture,
  layer: /*#__PURE__*/ Input.gestureLayer(Keys.HoverGesture, (source) => ({ watch: Input.withInput(source, Recognizer.watchHover) })),
}
