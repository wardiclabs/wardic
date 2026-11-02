/**
 * The **`inView` Feature** (#511, ADR-0067 decision 3): an element's place in its viewport (`whileInView`, `onViewportEnter`, `onViewportLeave`, `viewport`), in a module of its own, so an app that
 * never imports it ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import type { Feature } from "../feature.ts"

/** The `inView` Feature's service: an element's intersections watched, over the Environment's Probe. */
export class InViewGesture extends /*#__PURE__*/ Context.Service<
  InViewGesture,
  {
    readonly watch: (
      target: unknown,
      options: Recognizer.InViewOptions,
      handlers: InputFeed.Handlers<Recognizer.ViewTransition>,
    ) => Effect.Effect<void, never, Scope.Scope | Probe.Probe>
  }
>()("@wardic/solid/InViewGesture") {}

/** In-view gestures: `whileInView` and the viewport callbacks. It reads no input: the Probe's intersections. */
export const inView: Feature<InViewGesture, InViewGesture["Service"]> = {
  name: "inView",
  key: InViewGesture,
  layer: /*#__PURE__*/ Layer.succeed(InViewGesture)({ watch: Recognizer.watchInView }),
}
