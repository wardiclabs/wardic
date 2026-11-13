---
"@wardic/solid": patch
---

`<AnimatePresence>` keeps SVG children through their exits: a Wardic SVG element directly under it (`wardic.circle`, `w.rect`), a plain `<g>` with one inside, or a keyed `createBatch` member drawn on an SVG element. Each left at once, with no exit, as the presence counted only HTML elements. Under `mode="wait"`, an entering SVG child waits for the leavers, as an HTML one does. Under `mode="popLayout"`, an `<svg>` root is popped out of the flow as an HTML leaver is, beyond Motion's, which pops only HTML elements: in an icon swap, the leaving icon exits over the new one rather than beside it. The SVG elements inside an `<svg>` exit where they are.
