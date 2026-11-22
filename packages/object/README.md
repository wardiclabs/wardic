# @wardic/object

Wardic for any object's properties: Motion's `animate` on plain objects, on frames your loop pumps. It's the base for canvas and WebGL, under any library that draws them.

```ts
import * as WardicObject from "@wardic/object/WardicObject"

const wardic = WardicObject.make()
renderer.setAnimationLoop((time) => {
  wardic.frame(time) // Wardic's writes for this frame, before it's drawn
  renderer.render(scene, camera)
})

await wardic.animate(material, { opacity: 0 }, { duration: 0.4 })
wardic.animate(sprite, { x: 100, rotate: 90 }, { type: "spring", bounce: 0.3 })
```

- **Keys** are an object's own properties, by name. Each starts from its value when the animation starts.
- **Values** are numbers, and strings with a unit or of numbers.
- **Transitions** are Motion's by a key's name when none is given: a spring for a transform's key, an ease for any other.
- **The controls** are awaitable, with `stop`, `cancel`, `complete`, `pause`, `play`, `speed`, `time` and `duration`.
- **`afterWrites(fn)`** runs your own code each frame, after Wardic's writes and before the render.

Private until Wardic 1.3: not on npm yet. See [the roadmap](https://wardic.dev/roadmap).
