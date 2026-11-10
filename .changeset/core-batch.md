---
"@wardic/core": minor
---

A new `Batch` module animates many subjects on the same keys as one run on the Frame loop, for a list, a grid or a chart's points that move together. Each member's values, velocities and targets are kept by index, so a new target turns every member toward it at the speed it already has, and a change costs an array write per member rather than an animation each. A Batch runs springs and tweens, one transition for all or one per key, with a delay that staggers the members a change moves. Members enter and leave as the collection changes, and an Environment's writer draws each one as it moves. It's for binding and Environment authors: the bindings' `createBatch` comes next.
