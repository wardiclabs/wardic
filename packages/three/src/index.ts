/**
 * `@wardic/three`: Wardic for three.js. Motion's `animate` on a scene's meshes, materials, cameras,
 * lights and uniforms, by Motion's key names in three's own types, on frames the Host loop pumps. The
 * root re-exports each module as a namespace; code imports the subpath,
 * `import * as WardicThree from "@wardic/three/WardicThree"`.
 *
 * Private until 1.3: not on npm yet.
 *
 * @example
 * import { WardicThree } from "@wardic/three"
 *
 * const wardic = WardicThree.make()
 * renderer.setAnimationLoop((time) => {
 *   wardic.frame(time)
 *   renderer.render(scene, camera)
 * })
 * wardic.animate(cube, { y: 2, rotateY: 180 })
 *
 * @module
 */
// #883 (ADR-0068, ADR-0069, ADR-0073): private until 1.3, with `@wardic/object`.
export * as ThreeColours from "./ThreeColours.ts"
export * as ThreeRenderer from "./ThreeRenderer.ts"
export * as ThreeValues from "./ThreeValues.ts"
export * as WardicThree from "./WardicThree.ts"
