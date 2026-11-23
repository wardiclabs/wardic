/**
 * `stageBatches` (#885's PR 5): `createBatch`'s scene Batches as a Stage's feature, each a run of core's
 * Batch over its objects or an `InstancedMesh`'s instances.
 *
 * @module
 */
import type { StageFeature } from "./feature.ts"
import { bindSceneBatch } from "./scene-batch.ts"

/** A scene's Batches: give it to `createStage`'s `features` for `createBatch({ object | instances, … })`. */
export const stageBatches: StageFeature = {
  batch: ({ scene }, environment) => (config, hooks) => bindSceneBatch({ environment, scene }, config, hooks),
}
