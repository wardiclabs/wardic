---
"@wardic/solid": minor
---

`ward` takes its element first, and finds a scene's Stage (#884):

- **`ward(element, config)`** is `ward(config)(element)`, for an element you already have, with `held`: it renders nothing, and while the ward's config is still loading it holds its component's `<Loading>`, so the fallback shows and `<Reveal>` orders it. `w.ward` and a typed instance's `w.ward` take the same form.
- **`WardicStage`**, a Solid context a scene's Stage is given through (`<WardicStage value={stage}>`), and the `Stage` interface, which names no three.js code. Under one, `ward(subject, config)` hands the Stage a Subject that's its own, or any accessor of one, and `createFrameEffect` runs in the Stage's Host loop. An Environment types its Subjects by adding them to `StageSubjects`. `@wardic/three/solid`'s `createStage` makes a Stage for three.js.

A config first keeps its meaning, so `ward(config, { parent })` is unchanged. Solid 2 only.
