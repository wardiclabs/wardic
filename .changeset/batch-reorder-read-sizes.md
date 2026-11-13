---
"@wardic/solid": minor
---

`Reorder.BatchGroup` reads its items' sizes from the page when `itemSize` is left out (#714): rows as tall as their text, cards as large as their content. One observer reads every item's size, always on. Until the first sizes are read, on the server and on the client alike, the items are laid out in flow (a flex column, a flex row, or `flex-wrap` rows, the group's `gap` as CSS's), and then each is placed where flow had it, so nothing moves as it hydrates. A size that changes later, from an image loading or text wrapping again, moves the items after it on the group's transition, and the group's own size follows a frame later. In a column, each item is as wide as the group's content box. `columns` with no `itemSize` is a type error. Space the items with `gap`: an item's margins count in flow but not in its place.
