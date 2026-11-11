---
"@wardic/dom": patch
"@wardic/solid": patch
---

`Reorder.Group` and `Reorder.BatchGroup` take `values` from a store. The keyboard reorder no longer drops its item after one step, an app's own change while an item is lifted drops it at its new place, a drag goes on past its first crossover, and an app's reorder of the store in place animates, on both bindings. The Reorder controller tells the order it asked for by its items, not its array.
