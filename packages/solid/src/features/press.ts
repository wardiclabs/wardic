/**
 * The **`press` Feature** (#511, ADR-0067 decision 3): an element's press, its Keyboard presses included (`whileTap`, `onTap…`; Solid 2's `"tap"` events), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { LazyArg } from "effect/Function"
import type * as Scope from "effect/Scope"
import type { Feature } from "../feature.ts"
import { watchPressOn } from "../press.ts"
import { gestureLayer, withInput } from "./input.ts"

/** The `press` Feature's service: an element's presses watched (`press.ts`), over the gestures' input. */
export class PressGesture extends /*#__PURE__*/ Context.Service<
  PressGesture,
  {
    readonly watch: (
      element: unknown,
      handlers: InputFeed.Handlers<Recognizer.PressEvent>,
      keysTaken?: boolean,
      propagates?: LazyArg<boolean>,
    ) => Effect.Effect<void, never, Scope.Scope>
  }
>()("@wardic/solid/PressGesture") {}

/** Press gestures, a pointer's and the keyboard's: `whileTap` and the tap callbacks. */
export const press: Feature<PressGesture, PressGesture["Service"]> = {
  name: "press",
  key: PressGesture,
  layer: /*#__PURE__*/ gestureLayer(PressGesture, (source) => ({ watch: withInput(source, watchPressOn) })),
}
