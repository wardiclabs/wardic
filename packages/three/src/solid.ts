/**
 * `@wardic/three/solid` (ADR-0073 decision 20): a three.js scene for Solid 2's hooks. `createStage` makes
 * the Stage that runs a scene for its owner; under `<WardicStage value={stage}>`, `ward`, `createBatch`,
 * `createFrameEffect` and the sensors run in that scene, and `createSceneObject` adds an object to it,
 * with an exit as it leaves. Its hooks are a scene's alone, with none of the page's code (#927):
 * `@wardic/solid`'s own take a mesh too, for a page that has both. Importing it types three's objects as
 * a Stage's Subjects, so `ward(mesh, config)` and `ward(material, config)` typecheck.
 *
 * @example
 * import { createStage, ward, WardicStage } from "@wardic/three/solid"
 *
 * const stage = createStage({ renderer: () => new WebGLRenderer({ antialias: true }), scene, camera })
 * <WardicStage value={stage}>
 *   <div class="viewport" ref={stage} />
 *   <Crate />
 * </WardicStage>
 *
 * @module
 */
// #885 (ADR-0073, *Amendment (#885)*): step 4 of #564, Solid 2 only.
import type { Material, Object3D, Plane } from "three"

// A scene's hooks alone (#927): `@wardic/solid`'s Stage halves under the hooks' own names, so a scene with
// no page wards carries none of the page's ward, Batch or gesture Features (57.6 KB gzipped for `ward`).
export {
  createBatchOnStage as createBatch,
  createDragOnStage as createDrag,
  createFrameEffect,
  createHoverOnStage as createHover,
  createPressOnStage as createPress,
  wardOnStage as ward,
  WardicStage,
} from "@wardic/solid"
export type { StageFeature, StageParts, StageView } from "./solid/feature.ts"
export { createSceneObject, type SceneObject, type SceneObjectConfig } from "./solid/scene-object.ts"
export { stageBatches } from "./solid/stage-batches.ts"
export { stageDrag } from "./solid/stage-drag.ts"
export { type AdoptOptions, createStage, isThreeSubject, type RendererLike, type StageOptions, type ThreeStage } from "./solid/stage.ts"
export * as TestStage from "./solid/test-stage.ts"

// A Stage's Subjects, for `ward`'s types: three's objects and materials (Q2); and its drag's plane (#885's PR 4).
declare module "@wardic/solid" {
  interface StageSubjects {
    readonly three: Object3D | Material
  }
  interface StageDragConfig {
    /** A fixed plane, in world space, to drag on: the ground's, `new Plane(new Vector3(0, 1, 0), 0)`. */
    readonly dragPlane?: Plane | undefined
  }
}
