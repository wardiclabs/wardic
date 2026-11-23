---
"@wardic/solid": minor
---

A Scene object's ward (#885): **`stageSceneObject(environment)`**, beside `stageWard`, is the ward an Environment's `createSceneObject` builds on. Given a **`StageMembership`** (what joins its Subject to the scene, and what takes it out):

- it joins its Subject once the ward can start, every key still loading landed, its `initial` drawn in its first frame;
- it takes `exit`, which plays on its own spine past its owner, from where its Subject is, before its Subject leaves: as its owner ends, or as an accessor gives `undefined` or another Subject, the next entering as the last exits;
- a Subject given again while its exit plays is taken back: its exit stops, and it returns from where it is;
- its handle, **`SceneWard`**, tells `exitStart` and `exitComplete` through `next`, `each` and `when`.

`ward(subject, { exit })` on a Stage's Subject is an error in development naming `createSceneObject`. Solid 2 only.
