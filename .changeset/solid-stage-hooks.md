---
"@wardic/solid": minor
---

A Stage's hooks alone (#927): `wardOnStage`, `createBatchOnStage`, `createHoverOnStage`, `createPressOnStage` and `createDragOnStage` are `ward`, `createBatch` and the sensors for a Stage's Subjects only, with none of the page's code. An Environment's binding re-exports them under the hooks' own names. A three.js scene importing `ward` from `@wardic/three/solid` no longer carries the page's ward and every Feature: 243.1 KB gzipped, against 300.5 through `ward` from `@wardic/solid`, which still takes a scene's object too.
