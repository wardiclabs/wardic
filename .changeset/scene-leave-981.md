---
"@wardic/solid": patch
"@wardic/three": patch
---

A Scene object whose leave throws (an app's `removed` or `dispose` listener) now leaves all the same (#981). Before, `exitComplete` was never told, so `next("exitComplete")` never resolved and its exit waits never ended. With no `exit`, the throw came out of its owner's end.

```ts
mesh.addEventListener("removed", () => {
  throw new Error("a cache's listener broke")
})
const card = createSceneObject(mesh, { animate: { x: 1 }, exit: { x: 0 } })
// … its owner ends, and its exit plays and lands
await card.next("exitComplete")
// before: never resolved
// now: resolves, and "wardic.stage: a Subject's leave failed" is logged
```

- **However it lands,** with no `exit` as its owner ends, as its exit lands, or at the Stage's end, `exitComplete` is told, and the throw is logged once as `wardic.stage: a Subject's leave failed`.
- **With `dispose: true`,** every geometry and material is still disposed, though a listener on one of them throws.
- **A scene Batch** (`createBatch` on a Stage) removes every member leaving in one change, though one's `removed` listener throws, and disposes it with `dispose: true`. It's logged the same way.
