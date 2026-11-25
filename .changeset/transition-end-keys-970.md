---
"@wardic/core": patch
"@wardic/object": patch
"@wardic/three": patch
---

`animate` refuses a Transition end's key the Subject lacks or can't write at the call, naming it, as it refuses a key the target animates (#970). Before, it failed only when the call landed. The end's later keys weren't set, `await` never resolved, and `state` stayed `"running"`.

```ts
const sprite = { x: 0, z: 0 }
wardic.animate(sprite, { x: 1, transitionEnd: { y: 2, z: 3 } })
// before: at the landing, "wardic.gate: an afterFlush call failed", and the call never finished
// now, at the call: wardic.animate: the object has no "y" to animate. …
```

- **Where:** every `animate` call of a Subject, in each Environment: `@wardic/object`'s, `@wardic/three`'s (a mesh's `id`, a frozen uniform) and the DOM's, whose own value for the key is read at the call, as a ward's is. A ward's Transition end was refused as its leg starts already. A Segment takes no Transition end.
- **A key that can't be set by the landing:** one made read-only or deleted after the call. It's reported once, `wardic.animate: a Transition end's "y" couldn't be set, the rest of it set and the animation landed`, with the Environment's error as its cause. The rest of the end is set, and the call lands: `await` resolves and `state` reads `"finished"`.
