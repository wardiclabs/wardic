/**
 * The **`hover` Feature** (#511, ADR-0067 decision 3): an element's hover (`whileHover`, `onHoverStart`, `onHoverEnd`; Solid 2's `"hover"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as Recognizer from "@wardic/core/Recognizer"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { Feature } from "../feature.ts"
import { gestureLayer, withInput } from "./input.ts"

/** The `hover` Feature's service: an element's hover watched, over the gestures' input. */
export class HoverGesture extends /*#__PURE__*/ Context.Service<
  HoverGesture,
  { readonly watch: (target: unknown, handlers: Recognizer.HoverHandlers) => Effect.Effect<void, never, Scope.Scope> }
>()("@wardic/solid/HoverGesture") {}

/** Hover gestures: `whileHover` and the hover callbacks. */
export const hover: Feature<HoverGesture, HoverGesture["Service"]> = {
  name: "hover",
  key: HoverGesture,
  layer: /*#__PURE__*/ gestureLayer(HoverGesture, (source) => ({ watch: withInput(source, Recognizer.watchHover) })),
}
