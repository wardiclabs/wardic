---
"@wardic/core": minor
---

`Batch.draw` writes every member where it is now, with no step, and flushes the writer: a change that starts its members from their targets is drawn at once, before the page paints. And `Batch.enter` starts each key's origin at its start, so a member moved on a tween no longer draws its other keys from 0 (or from a reused slot's last): a keyed `createBatch` whose members moved while one left under `<AnimatePresence>` drew the leaver's position and the others' `opacity` from 0.
