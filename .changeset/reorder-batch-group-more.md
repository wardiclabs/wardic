---
"@wardic/solid": minor
---

`Reorder.BatchGroup` takes `whileHover` and `whileTap`, its items' Enter and Space pressing them only while the keyboard reorder is off; `exit`, for items leaving under `<AnimatePresence>`; `direction`, a row's and a grid's places mirrored right to left, read from the group's element when it's left out; and a grid's `columns` left out, as many as the group's width holds, read again as it's resized. On a server each item renders at its place, a grid with no `columns` by CSS grid, so hydrating moves nothing. A `Reorder.BatchItem` renders `draggable="false"`, as a `Reorder.Item` does.
