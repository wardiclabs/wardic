---
"@wardic/solid": minor
---

Drag on a scene (#885): a ward on a Stage's Subject takes `drag` and `whileDrag`, and its Stage drags it.

- **`StageDragConfig`:** `drag` (`true`, or `"x"`, `"y"` or `"z"`), `dragConstraints` per axis as `[min, max]`, `dragElastic`, `dragMomentum`, `dragTransition` and `dragSnapToOrigin`, in the page's drag keys' place. An Environment adds its own by declaration merging (`@wardic/three/solid` adds `dragPlane`).
- **The Stage drags:** a Stage gives a **`StageDrag`** (`Stage.drag`, and the Stage ward's environment's `drag`), which moves the Subject. A `drag` on a Stage with none is an error in development.
- **Events:** the ward tells `dragStart`, `drag`, `dragEnd` and `dragTransitionEnd` with the pointer's samples, as a ward on an element does, and `createDrag(card)` reads them.
- **`createDrag(mesh)`** reads a Stage's Subject's drags through the scene's input. A plain object first is still the sensor's options.
- **`StageWardConfig`** types a ward's config on a Stage's Subject. `ward<C>` for a page's `C` still instantiates.

Solid 2 only.
