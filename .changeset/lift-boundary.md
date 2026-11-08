---
"@wardic/solid": patch
---

On Solid 2, a keyboard lift and drop no longer re-run a `Reorder.Item`'s target when the item has no `whileDrag` of its own: it resolved the same either way, and Solid's development build could report the wasted work (`WASTED_RECOMPUTE`).
