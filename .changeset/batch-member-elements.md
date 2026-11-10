---
"@wardic/solid": minor
---

`createAnimate`'s `animate` of a Batch member's element moves the member: the Batch's keys in the Batch, as `animate(grid.at(i), …)` does, and every other key as on any element, under one set of controls, so the Batch's next change goes on from where the call left it. A selector or a list of members moves them as one call over them, in the list's order, and its `stagger()` counts the members that move; a plain element in the same list keeps its own delay by its place in it. Through an element, a Batch's key takes a number or two stops, and a transform the Batch draws without having it as a key, such as `rotate` on a Batch of `x` and `y`, is an error naming the key. A member's handle made without its own `style` gives none, so a `style` the element sets before the spread stays on Solid 2.
