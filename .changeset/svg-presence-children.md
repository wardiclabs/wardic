---
"@wardic/solid": patch
---

`<AnimatePresence>` keeps SVG children through their exits: a Wardic SVG element directly under it (`wardic.circle`, `w.rect`), a plain `<g>` with one inside, or a keyed `createBatch` member drawn on an SVG element. Each left at once, with no exit, as the presence counted only HTML elements. Under `mode="wait"`, an entering SVG child waits for the leavers, as an HTML one does. Under `mode="popLayout"`, an SVG leaver isn't popped, the `<svg>` root included, as Motion's: it exits where it is. Wrapped in an HTML element, it pops with it.
