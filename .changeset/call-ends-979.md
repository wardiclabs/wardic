---
"@wardic/core": patch
---

A sequence's function Segment that throws no longer leaves its call stuck, and a call's `delay` that throws takes nothing (#979).

```ts
const sequence = wardic.animate([
  [ball, { x: 10 }],
  [(value) => draw(value), [0, 1], { at: 0 }], // draw throws for a frame or two
])
// before: the sequence stayed "running" for good, and its callback was told nothing more
// now: it's told each later frame's value, the sequence finishes, and "wardic.animate: a function Segment failed" is logged once
```

- **A function Segment's callback that throws** is logged once until it returns, and is still told each later frame's value: its sequence lands as its stops do. One that throws at its last frame isn't told that value again.
- **On `cancel()`,** a callback that throws as it's told its first stop is logged, and the rest of the call is still cancelled: nothing comes out of `cancel()`.
- **A `delay(i, n)` that throws** for a later Subject, or for a Batch's member, is an error at the call that takes nothing, as a key a Subject can't take is, and its scope isn't left waiting on it. Before, the earlier Subjects had already taken their keys from the animations running them.
