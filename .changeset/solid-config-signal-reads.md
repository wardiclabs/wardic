---
"@wardic/solid": patch
---

A `WardicConfig` prop from a signal no longer makes Solid 2 report STRICT_READ_UNTRACKED. Its `reducedMotion` and `skipAnimations` are read as each animation starts, an exit's in its presence's effect, and its `transition` at each change of a `createBatch` or a `Reorder.BatchGroup`; an `isValidProp` that reads a signal is read once, as each element is made. Each read is untracked now, which is what it always was: a change applies to the next animation, or to the next element made. `useIsPresent`'s example binds it to an event handler, not to an attribute, which the child's leave disposes before it turns `false`.
