---
"@wardic/dom": patch
---

`Appear.find` passes over a Batch's rule: a Wardic element on a Batch member's element no longer takes its Batch's Appear animation for its own. `Appear.pending` and `Appear.release` sit in a module of their own, so code that only asks whether an element's Appear animation still runs, or lets it go, no longer bundles the Handoff's reads (`findAll`, `matchesBatch`, `elapsedOf`) with them.
