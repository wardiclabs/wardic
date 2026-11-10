---
"@wardic/core": minor
"@wardic/dom": minor
"@wardic/solid": minor
---

`createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatchWriter`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch changes can now give each member its own transition and say how many members they set off.
