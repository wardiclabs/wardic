/**
 * The **`inView` Feature** (#511, ADR-0067 decision 3): an element's place in its viewport (`whileInView`, `onViewportEnter`, `onViewportLeave`, `viewport`), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as Recognizer from "@wardic/core/Recognizer"
import * as Layer from "effect/Layer"
import type { Feature } from "../feature.ts"
import { InViewGesture } from "./keys.ts"

/** In-view gestures: `whileInView` and the viewport callbacks. It reads no input: the Probe's intersections. */
export const inView: Feature<InViewGesture, InViewGesture["Service"], "inView"> = {
  name: "inView",
  key: InViewGesture,
  layer: /*#__PURE__*/ Layer.succeed(InViewGesture)({ watch: Recognizer.watchInView }),
}
