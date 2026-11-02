/**
 * The **`pan` Feature** (#511, ADR-0067 decision 3): an element's pan (`onPan`, `onPanStart`, `onPanSessionStart`, `onPanEnd`; Solid 2's `"pan"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { Feature } from "../feature.ts"
import { gestureLayer, withInput } from "./input.ts"

/** The `pan` Feature's service: an element's pans watched, over the gestures' input. */
export class PanGesture extends /*#__PURE__*/ Context.Service<
  PanGesture,
  {
    readonly watch: (
      target: unknown,
      handlers: InputFeed.Handlers<Recognizer.PanSample>,
      options?: Recognizer.PanOptions,
    ) => Effect.Effect<void, never, Scope.Scope>
  }
>()("@wardic/solid/PanGesture") {}

/** Pan gestures: the pan callbacks. */
export const pan: Feature<PanGesture, PanGesture["Service"]> = {
  name: "pan",
  key: PanGesture,
  layer: /*#__PURE__*/ gestureLayer(PanGesture, (source) => ({ watch: withInput(source, Recognizer.watchPan) })),
}
