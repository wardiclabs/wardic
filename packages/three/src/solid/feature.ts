/**
 * A Stage's features (#885's PR 5): what a scene app adds to `createStage`'s `features` for what it uses,
 * as a page's Features are given to its provider, so a scene that uses none carries none of their code.
 *
 * - **`stageDrag`** drags a ward's Subject (`ward(mesh, { drag })`), `@wardic/three`'s `ThreeDrag`.
 * - **`stageBatches`** makes `createBatch`'s scene Batches (`object`, `instances`).
 *
 * A ward's `drag`, or a scene's `createBatch`, on a Stage without its feature is an error in development
 * naming it.
 *
 * @module
 */
// #885's PR 5: the owner's choice, opt-in, after drag (PR 4) and Batches (PR 5) were 5.1 KB gzipped in every scene app.
import type { Stage, StageDrag, StageWardEnvironment } from "@wardic/solid"
import type { Camera, Object3D } from "three"
import type * as WardicThree from "../WardicThree.ts"

/** What a Stage drags with: its camera and its canvas, once there is one. A Stage adopting a runtime has neither. */
export interface StageView {
  readonly camera: Camera | (() => Camera)
  /** Its canvas, where it is on the page. */
  readonly canvas: () => { readonly getBoundingClientRect: () => { readonly left: number; readonly top: number; readonly width: number; readonly height: number } } | undefined
}

/** What a feature builds on: the Stage's runtime, its view, its wards' environment, and its scene. */
export interface StageParts {
  readonly runtime: WardicThree.WardicThree
  readonly view: StageView | undefined
  readonly scene: Object3D | undefined
}

/** A Stage's feature: the drag it gives, or the Batches it makes, from its parts. */
export interface StageFeature {
  /** Its drag: none on a Stage with no view of its own. */
  readonly drag?: ((parts: StageParts) => StageDrag | undefined) | undefined
  /** Its Batches, made on its wards' environment. */
  readonly batch?: ((parts: StageParts, environment: StageWardEnvironment) => NonNullable<Stage["batch"]>) | undefined
}
