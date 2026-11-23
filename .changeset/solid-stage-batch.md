---
"@wardic/solid": minor
---

`createBatch` in a scene (#885): under a `<WardicStage>`, a config with `object` (a three.js object per member) or `instances` (an `InstancedMesh`) goes to the Stage's **`batch`**, which adds, moves and removes its members as one run.

- **Its forms:** keyed (`each` and `key`) or by `count`, with `initial`, `animate`, `transition` (`stagger()` counting the members a change moves), `whileHover`, `whileTap`, and, keyed, `exit` and `dispose`.
- **Its handle,** a **`StageBatch`**, has `settled`, `next` and `when`, as a page's Batch's. Its members' hovers and presses carry `{ i, item, element }`.
- **The types:** `StageKeyedBatchConfig`, `StageCountBatchConfig` and the rest. An Environment's side is `StageBatchBinding` and `StageBatchHooks`.

A scene config with no Stage that makes Batches is an error in development, and so is a ward's `drag` on a Stage that drags nothing. Each names the Stage feature to give: with `@wardic/three/solid`, `createStage({ …, features: [stageBatches] })` or `[stageDrag]`. Solid 2 only.
