/**
 * `stageDrag` (#885's PR 5): drag in 3D as a Stage's feature, `@wardic/three`'s `ThreeDrag` on the Stage's
 * camera and canvas. A Stage adopting a runtime has neither, and drags nothing.
 *
 * @module
 */
import * as Spine from "@wardic/core/unstable/Spine"
import type { StageDrag } from "@wardic/solid"
import * as UndefinedOr from "effect/UndefinedOr"
import * as ThreeDrag from "../ThreeDrag.ts"
import type { StageFeature } from "./feature.ts"

/** Drag in 3D: give it to `createStage`'s `features` for `ward(mesh, { drag })`. */
export const stageDrag: StageFeature = {
  drag: ({ runtime, view }) =>
    UndefinedOr.map(
      view,
      (given): StageDrag =>
        ThreeDrag.make({
          animate: runtime.animate as unknown as ThreeDrag.Options["animate"],
          camera: given.camera,
          canvas: given.canvas,
          unitScale: Spine.unitScaleOf(runtime.stageEnvironment.runtime),
        }) as unknown as StageDrag,
    ),
}
