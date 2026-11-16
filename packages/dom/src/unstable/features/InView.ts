/**
 * The **`inView` Feature** (#511, ADR-0067 decision 3): an element's place in its viewport (`whileInView`, `onViewportEnter`, `onViewportLeave`, `viewport`), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/in-view.ts`, moved to dom with the Features, for
// every DOM binding.
import * as Recognizer from "@wardic/core/Recognizer"
import * as Layer from "effect/Layer"
import type * as Feature from "../Feature.ts"
import * as Keys from "./Keys.ts"

/** In-view gestures: `whileInView` and the viewport callbacks. It reads no input: the Probe's intersections. */
export const inView: Feature.Feature<Keys.InViewGesture, Keys.InViewGesture["Service"], "inView"> = {
  name: "inView",
  key: Keys.InViewGesture,
  layer: /*#__PURE__*/ Layer.succeed(Keys.InViewGesture)({ watch: Recognizer.watchInView }),
}
