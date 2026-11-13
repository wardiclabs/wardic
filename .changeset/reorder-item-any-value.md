---
"@wardic/solid": patch
---

`Reorder.Item` takes a value of any type on both bindings, an object too, as Motion's does: its props no longer meet its value with the `value` attribute of the element it renders, whose type, a string or a number, rejected an object value (#748). The item never handed `value` to its element, so nothing changes at runtime.
