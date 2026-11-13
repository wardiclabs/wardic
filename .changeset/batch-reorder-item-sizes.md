---
"@wardic/solid": minor
---

`Reorder.BatchGroup` takes items of different sizes (#714): `itemSize` can be a function, `(item, i) => ({ width, height })`, giving each item its own size. Each item is placed after the sizes before it: below them in a column, beside them in a row, and in a grid (`"xy"`) on rows that break where the next item doesn't fit the group's width, each item at its row's top. The function is called for every item at each change of the list and is tracked, so a size it reads that changes moves the items after it on the group's transition. The server places every item, and a grid lays its items out with `flex-wrap` until its width is read. `columns` with a function is a type error.

In a column, a size can leave out `width`, as an object (`itemSize={{ height: 48 }}`) or a function's: each item is as wide as the group's content box, with its padding and border inside, so a list fills a responsive container. The group sets no width of its own: it's a CSS size container (`container-type: inline-size`), each such item `100cqi` wide, exact on the server too.
