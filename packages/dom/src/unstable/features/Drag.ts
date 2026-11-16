/**
 * The **`drag` Feature** (#511, ADR-0067 decision 3): an element's drag (`drag`, `dragControls`, its
 * constraints, its release's inertia; Solid 2's `"drag"` events), in a module of its own, so an app that
 * never imports it ships none of it: the drag track (`DragTrack`), core's `Drag` and `Inertia`. Its
 * top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/drag.ts`, moved to dom with the Features, for
// every DOM binding.
import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import * as DragConstraints from "../DragConstraints.ts"
import * as DragTrack from "../DragTrack.ts"
import type * as Feature from "../Feature.ts"
import * as Keys from "./Keys.ts"
import * as Input from "./Input.ts"

/** Drag gestures: `drag`, `dragControls`, the drag callbacks, and what a `Reorder` item drags with. */
export const drag: Feature.Feature<Keys.DragGesture, Keys.DragGesture["Service"], "drag"> = {
  name: "drag",
  key: Keys.DragGesture,
  layer: /*#__PURE__*/ Input.gestureLayer(Keys.DragGesture, (source) => ({
    drive: (run) =>
      DragTrack.driveDragTrack({
        ...run,
        watch: (track) => run.watch((onDefect) => Effect.provideService(track(onDefect), InputSource.InputSource, source)),
        fork: (response) => run.fork(Effect.provideService(response, InputSource.InputSource, source)),
      }),
    constraintsOf: DragConstraints.trackConstraintsOf,
  })),
}
