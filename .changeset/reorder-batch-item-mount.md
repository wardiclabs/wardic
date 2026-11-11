---
"@wardic/solid": patch
---

A `Reorder.BatchItem` mounts in less time. On Solid 1 its element is made as `<Dynamic>` makes one, without its props merged, and its style, tab stop and `aria-describedby` are the group's, written once as it's made and again by the group when they change; an item with its own keeps them, over the group's. On both bindings the keyboard instructions' id is the group's, once for every item.
