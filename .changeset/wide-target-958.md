---
"@wardic/object": patch
"@wardic/three": patch
---

A target can carry its own `transition` and `transitionEnd` when its Subject's keys are any name (#958): a `ShaderMaterial`'s or a `RawShaderMaterial`'s, whose `uniforms` three types as any name, a mesh drawn with one, and an object with an index signature. It always ran; TypeScript rejected it.

```ts
wardic.animate(shader, { uProgress: 1, transition: { duration: 1 }, transitionEnd: { uProgress: 0 } })
```

- **How it's checked:** each key the target gives. `transition` is checked as a transition, which can have an entry under any name; `transitionEnd` as its values; any other key as a value, of the same type as before. So an object given as a value, or a misspelt transition field, is still an error.
- **What it can't check:** since any name is one of such a Subject's keys, a misspelt key isn't caught, even a mesh's own (`rotatY`).
- **Subjects with known keys** keep their types. A call that names its Subject's type, `animate<T>(…)`, keeps the target it had: values only.
