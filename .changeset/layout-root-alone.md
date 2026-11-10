---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.
