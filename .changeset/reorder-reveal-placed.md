---
"@wardic/dom": patch
---

A Reorder controller built with `ReorderController.makePlaced` reveals a keyboard step's and a cancel's new place when its binding calls `placed()` within `onReorder` itself, before the reorder returns.
