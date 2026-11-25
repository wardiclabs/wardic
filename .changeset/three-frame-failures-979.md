---
"@wardic/three": patch
---

A raycast, a render or an exit's landing that throws no longer stops a scene (#979). Before, a `hitTest`, a camera function or an object's `raycast` that threw came out of `frame(t)` before Wardic's writes, so nothing on the scene animated, every frame, with nothing logged.

```ts
const wardic = WardicThree.make({ canvas, camera, scene, hitTest: (raycaster) => bvh.cast(raycaster) })
wardic.hover(crate, onHover)
// a hitTest that throws
// before: wardic.frame(t) threw every frame, and no animation moved
// now: every animation runs and lands; "wardic.input: a raycast failed" is logged once, until a raycast succeeds
```

- **A raycast that throws,** each frame's or a press's, is logged once until one succeeds. A pointer keeps what it was over, and a down or a release hits nothing.
- **A Stage's render that throws** (an object's `onBeforeRender`, say) is logged once, `wardic.stage: a render failed`, until a render draws, and the loop goes on.
- **A Stage's end** lands every exit still in flight, even when one's landing throws (an app's `removed` listener, say), which is logged. The loop, the canvas, the input and the runtime still stop. `TestStage`'s `dispose` does the same.
