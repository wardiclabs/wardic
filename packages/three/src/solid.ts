/**
 * `@wardic/three/solid` (ADR-0073 decision 20): a three.js scene for Solid 2's hooks. `createStage` makes
 * the Stage that runs a scene for its owner; under `<WardicStage value={stage}>`, `@wardic/solid`'s `ward`,
 * `createFrameEffect` and the sensors run in that scene, and `createSceneObject` adds an object to it,
 * with an exit as it leaves. Importing it types three's objects as a Stage's
 * Subjects, so `ward(mesh, config)` and `ward(material, config)` typecheck.
 *
 * @example
 * import { createStage, WardicStage } from "@wardic/three/solid"
 * import { ward } from "@wardic/solid"
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

export { WardicStage } from "@wardic/solid"
export { createSceneObject, type SceneObject, type SceneObjectConfig } from "./solid/scene-object.ts"
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
