---
"@wardic/object": patch
"@wardic/three": patch
---

`animate` now types a Subject that is typed as a string record, a `Record<string, number>` or a ShaderMaterial's `uniforms` (#959). Its type was inferred as `object`, so no key typed, though the call ran.

```ts
const levels: Record<string, number> = { bass: 0, treble: 0 }
wardic.animate(levels, { bass: 1, transition: { duration: 1 } })
three.animate(shader.uniforms, { uProgress: 1 })
```

Its target is checked as any Subject's whose keys are any name: a misspelt key isn't caught, while each value, its own `transition` and its `transitionEnd` are. Other Subjects (meshes, materials, objects of known keys, lists of them) type as before.
