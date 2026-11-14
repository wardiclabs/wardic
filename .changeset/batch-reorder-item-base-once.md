---
"@wardic/solid": patch
---

A `Reorder.BatchGroup` works out its items' shared style once, in a memo each item reads, not once an item: what it reads of its element as it mounts and as it's resized re-runs its items only when that style changes. At 400 items on Solid 2, the read at mount re-ran 3 computations, not 402, and its `HUGE_FAN_OUT` warning is gone.
