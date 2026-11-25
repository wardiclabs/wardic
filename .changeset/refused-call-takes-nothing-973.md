---
"@wardic/core": patch
"@wardic/object": patch
"@wardic/three": patch
---

A call refused at the call takes nothing (#973). Before, a key a Subject can't take was refused only after the keys before it were taken. That's a later key of the same Subject, or any key of a list's or a sequence's later Subject. The animations drawing those keys ended where they were, never landing, and the new call never ran.

```ts
const ball = { x: 0 }
const pinned: { readonly x: number } = Object.freeze({ x: 0 })
const rolling = wardic.animate(ball, { x: 10 })
wardic.animate([ball, pinned], { x: 1 }) // throws: the object's "x" can't be written …
// before: ball stopped where it was, and `rolling` read "idle", never resolving
// now: ball rolls on to 10, and `rolling` lands
```

- **Every Environment, through core:** each Subject's keys, its target's and its Transition end's, are read before any is taken. A ward's mesh on a Stage keeps its own animation too.
- **Unchanged:** the error, at the call and naming the key; Batches, which take nothing until they play; the DOM, whose reads never throw.
