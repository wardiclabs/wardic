---
"@wardic/solid": minor
---

`Reorder.BatchGroup` and `Reorder.BatchItem`, on both bindings, reorder a long list of items of one size as one keyed Batch: each item is a member of the group's Batch, at the place its index gives (`axis`, a column, a row or a grid of `columns`; `itemSize`; `gap`), never measured, so a list of thousands mounts and drags at a Batch's cost. Items reorder by dragging and from the keyboard as a `Reorder.Group`'s do, with the same crossover, announcements, Auto-scroll and events; the DOM follows the order. The item in hand follows the pointer and flies back to its place at its release speed, raised while it's held, and the group's `whileDrag` lays its values over it while it's dragged or lifted. No item listens for input until it's pressed or focused. On Solid 2, `groupRef` hands out the group: `next`, `each` and `when` of its events, `move` and its axis.
