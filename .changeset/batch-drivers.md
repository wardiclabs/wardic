---
"@wardic/core": minor
"@wardic/dom": minor
"@wardic/solid": minor
---

A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg ends or its drag's release rests, or at the Batch's next change of the member. An element given two Batches' handles, and `layout` on a member's Wardic element, are errors. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have; the Flush gate's `release` takes `keep`, properties another writer draws next.
