---
"@wardic/solid": minor
---

`createBatch` takes a list: `createBatch({ each: () => todos(), key: "id", initial: { opacity: 0 }, animate: (todo, i) => ({ y: i * 48, opacity: 1 }) })`, with `list.member(todo.id)` spread onto each item's element. An item's member enters as its element arrives, from `initial`; a change of the list, or of its order, turns every member once, toward `animate(item, i)` at its index now, each keeping its speed; an item that leaves takes its member with it. `key` is a property's name or a function of the item; `keys` fixes the Batch's keys for a list that starts empty. `createAnimate`'s `animate` takes a keyed Batch and its members' handles.
