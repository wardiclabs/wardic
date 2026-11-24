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
import type {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  Line,
  LineDashedMaterial,
  Material,
  Mesh,
  MeshLambertMaterial,
  MeshMatcapMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshToonMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PointLight,
  Points,
  PointsMaterial,
  RectAreaLight,
  SpotLight,
  Sprite,
} from "three"
import type { ColourKey, SceneKey } from "./WardicThree.ts"

/**
 * The Subjects whose keys a scene's ward takes: a mesh of each of three's materials (the physical one's
 * keys hold the standard's), points, a dashed line, a sprite, the cameras and the lights. A union of
 * meshes, not a mesh of a union of materials, whose keys would be the materials' common ones alone.
 */
type SceneSubject =
  | Mesh<BufferGeometry, MeshPhysicalMaterial>
  | Mesh<BufferGeometry, MeshPhongMaterial>
  | Mesh<BufferGeometry, MeshLambertMaterial>
  | Mesh<BufferGeometry, MeshToonMaterial>
  | Mesh<BufferGeometry, MeshMatcapMaterial>
  | Points<BufferGeometry, PointsMaterial>
  | Line<BufferGeometry, LineDashedMaterial>
  | Sprite
  | PerspectiveCamera
  | OrthographicCamera
  | AmbientLight
  | DirectionalLight
  | HemisphereLight
  | PointLight
  | SpotLight
  | RectAreaLight

/** Every key three's `animate` takes on them, numbers and colours: what a ward's config on a Stage's Subject can name. */
type SceneValueKey = SceneKey<SceneSubject> | ColourKey<SceneSubject>

/** What a three Subject's keys read as (#939): its own numbers, its vectors' axes and its material's, each a number. A colour animates by its channels, which read as numbers. */
type SceneReads<S> = { readonly [K in SceneKey<S>]: number }

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

// A Stage's Subjects, for `ward`'s types: three's objects and materials (Q2), and their values (#934); and its
// drag's plane (#885's PR 4).
declare module "@wardic/solid" {
  interface StageSubjects {
    readonly three: Object3D | Material
  }
  // Their values beyond an element's (#934): a material's `roughness`, a light's `intensity`, a camera's `fov`.
  interface StageValues extends Record<SceneValueKey, unknown> {}
  // What each of a Subject's keys reads as (#939), so a ward's `read` gives a mesh's `y` or a light's `intensity` as a number.
  interface StageReads<S> {
    readonly three: SceneReads<S>
  }
  interface StageDragConfig {
    /** A fixed plane, in world space, to drag on: the ground's, `new Plane(new Vector3(0, 1, 0), 0)`. */
    readonly dragPlane?: Plane | undefined
  }
}
