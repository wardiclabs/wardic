/**
 * The **`drag` Feature** (#511, ADR-0067 decision 3): an element's drag (`drag`, `dragControls`, its
 * constraints, its release's inertia; Solid 2's `"drag"` events), in a module of its own, so an app that
 * never imports it ships none of it: the drag track (`drag-track.ts`), core's `Drag` and `Inertia`. Its
 * top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import { trackConstraintsOf } from "../drag-constraints.ts"
import { driveDragTrack } from "../drag-track.ts"
import type { Feature } from "../feature.ts"
import { DragGesture } from "./keys.ts"
import { gestureLayer } from "./input.ts"

/** Drag gestures: `drag`, `dragControls`, the drag callbacks, and what a `Reorder` item drags with. */
export const drag: Feature<DragGesture, DragGesture["Service"]> = {
  name: "drag",
  key: DragGesture,
  layer: /*#__PURE__*/ gestureLayer(DragGesture, (source) => ({
    drive: (run) =>
      driveDragTrack({
        ...run,
        watch: (track) => run.watch((onDefect) => Effect.provideService(track(onDefect), InputSource.InputSource, source)),
        fork: (response) => run.fork(Effect.provideService(response, InputSource.InputSource, source)),
      }),
    constraintsOf: trackConstraintsOf,
  })),
}
