---
"@wardic/core": patch
---

A Reorder group with no `axis` finds its axis from its items' boxes in linear time. It used to make every pair of boxes first, so a long list stalled at each crossover of a drag: with 5,000 items, for up to 1.8 s. The axis it finds is the same as before, as Motion's: `"y"` for a column, `"x"` for a row, `"xy"` for a grid that wraps.
