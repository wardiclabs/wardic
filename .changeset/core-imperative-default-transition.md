---
"@wardic/core": minor
"@wardic/dom": patch
---

Core gives every Environment what the DOM's `animate` was built on (#882):

- **`DefaultTransition.byKey`, `KEYFRAMES_TWEEN` and `layerByKey`:** Motion's Default transition by a key's name. Transforms get a spring, a scale gets a critical spring, and any other key gets a 0.3 s ease. It was `@wardic/dom`'s, and `DomDefaultTransition` is now these same objects.
- **`@wardic/core/unstable/Imperative`:** the Imperative animation track (`animate`, its Playback controls and sequences), with ports for an Environment's Subjects and Batches. `@wardic/dom/unstable/Imperative` fills them for elements and keeps every export it had.
- **`@wardic/core/unstable/FrameEffects`:** an ordered list of app code an Environment runs at the end of each frame, after Wardic's writes.

The DOM's animations, sequences and Batches behave as they did.
