---
"@wardic/core": minor
"@wardic/dom": minor
---

Two additions for scenes, from #883:

- **`UnitScale`:** how many of Motion's units a key counts as, so a spring's rest thresholds fit the distances it moves. It's an Environment's rule by key and distance, 1 for every key by default. A scene in metres gives `UnitScale.layer(100)` for its `x`, `y` and `z`, so a long move's spring rests within millimetres instead of snapping short. `UnitScale.relative` rests a key by its share of the distance, as a blended key's progress does, and `UnitScale.layerWith` gives a rule of an Environment's own. `Machine.springValues` and `Batch.make` take a `unitScale` rule.
- **`scaleZ`:** core's third scale. It's a transform key, positional under reduced motion, and on a scale's spring by default. The DOM draws it as `scaleZ()`.
