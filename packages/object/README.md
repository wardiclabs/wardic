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
- **`wantsFrame()`** says whether Wardic wants another frame, for a loop that draws on demand.

## Many objects at once

A Batch moves many objects on the same keys as one run: hundreds of sprites, a chart's points, a grid of meshes. A new target turns each member toward it at the speed it has, for a fraction of what an animation per object costs.

```ts
const dots = wardic.batch(sprites)                                   // its keys: its first animate's, or `keys`
wardic.animate(dots, { x: (i) => i * 12, y: [0, 40] }, { delay: (rank) => rank * 0.01 })
wardic.animate(dots.at(3), { y: 0 })                                 // one member
dots.get(3, "y")                                                     // its value as drawn
```

- **Each key** is a number, two stops (its first and its target), or a function of a member's index and the count that gives them.
- **Its members** are reached through it: an object of a Batch given to `animate` itself is an error.
- **A sequence** can hold a Segment of a Batch, `[dots, { opacity: [0, 1] }]`, or of a member, `[dots.at(0), …]`.

Private until Wardic 1.3: not on npm yet. See [the roadmap](https://wardic.dev/roadmap).
