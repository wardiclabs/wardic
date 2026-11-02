/**
 * The **`focus` Feature** (#511, ADR-0067 decision 3): an element's focus as the browser shows it (`whileFocus`), in a module of its own, so an app that
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

/** The `focus` Feature's service: an element's focus watched, over the gestures' input. */
export class FocusGesture extends /*#__PURE__*/ Context.Service<
  FocusGesture,
  { readonly watch: (target: unknown, options: Recognizer.FocusOptions, handlers: InputFeed.Handlers<boolean>) => Effect.Effect<void, never, Scope.Scope> }
>()("@wardic/solid/FocusGesture") {}

/** Focus gestures: `whileFocus`. */
export const focus: Feature<FocusGesture, FocusGesture["Service"]> = {
  name: "focus",
  key: FocusGesture,
  layer: /*#__PURE__*/ gestureLayer(FocusGesture, (source) => ({ watch: withInput(source, Recognizer.watchFocus) })),
}
