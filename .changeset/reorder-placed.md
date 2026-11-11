---
"@wardic/dom": minor
---

`ReorderController.makePlaced` builds a Reorder group's controller for items placed from their index rather than measured, a Batch Reorder group's: it needs only an `Announcer`, no projection system, and its binding calls `placed()` once it has placed a new order, where `make`'s controller waits for a Measure pass; it's a `ReorderController.Placed`. An item registers a `ReorderController.ItemHandle`, its box, drag offset and version, how to raise it, and, for a placed item, its place on screen (`placeOnScreen`), which a keyboard step's reveal scrolls into view. A projection node's handle is one, so `make`'s items register as before.
