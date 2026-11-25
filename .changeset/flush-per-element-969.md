---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/object": patch
"@wardic/three": patch
---

One element whose writes fail no longer stops the others' (#969). Before, a commit that threw ended the frame's flush, so every element after it went unwritten that frame, other animations' among them, and the error was logged every frame.

```ts
const stuck = { x: 0 }
const plain = { x: 0 }
wardic.animate(stuck, { x: 1 })
wardic.animate(plain, { x: 1 })
Object.freeze(stuck) // after its animation started
// before: plain.x stayed where it was, and "wardic.gate: a flush failed" was logged every frame
// now: plain animates and lands; "wardic.gate: a commit failed" is logged once, for `stuck`
```

- **Each element's own:** a throw in its commit, the read of its own value, its Timeline values, or its binding's `beforeFirstCommit` or `onHeld`. That element commits nothing that frame, and every other element still commits, in a frame's flush and in a layout pass's.
- **Reported once,** naming the step (`a commit failed`, `a beforeFirstCommit failed`, `an onHeld failed`, `a Timeline sync failed`) and annotated with the element's gate id, until it commits again.
- **Its animation runs on:** each frame tries again, so it recovers by itself, or lands as before.
