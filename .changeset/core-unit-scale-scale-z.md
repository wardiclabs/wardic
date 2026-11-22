---
"@wardic/core": minor
"@wardic/dom": minor
---

Two additions for scenes, from #883:

- **`UnitScale`:** how many of Motion's units an Environment's `x`, `y` and `z` count as. It's 1 by default; a scene in metres gives `UnitScale.layer(100)`, so a long move's spring rests within millimetres instead of snapping short. `Machine.springValues` and `Batch.make` take a `unitScale`.
- **`scaleZ`:** core's third scale. It's a transform key, positional under reduced motion, and on a scale's spring by default. The DOM draws it as `scaleZ()`.
