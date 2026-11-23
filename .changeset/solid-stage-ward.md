---
"@wardic/solid": minor
---

A ward on a scene's Subject, and the sensors on one (#884):

- **`stageWard(environment)`** is the `ward` a Stage hands out: under a `<WardicStage>`, `ward(mesh, config)` moves its Subject as a ward moves an element, with `initial`, `animate` (one still loading held with `held`), `transition`, its own `variants`, `whileHover` and `whileTap` through the Stage's input, its events, `read` and `atom`. Given an accessor, it follows each Subject the accessor gives, with no exit. Other keys are an error in development, naming them.
- **`createHover(mesh)`** and **`createPress(mesh)`** read the pointer over a Stage's Subject, and pressed on it, through the Stage's input.
- **`StageWard`** gains `tapped` and `atom`; its events are typed `StageEvents`, each with the Subject as its `element`.

`@wardic/three/solid`'s `createStage` builds on it. Solid 2 only.
