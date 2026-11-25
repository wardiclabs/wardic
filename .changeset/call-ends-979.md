---
"@wardic/core": patch
---

A sequence's function Segment, or a call's `delay`, that throws no longer leaves its call stuck (#979).

```ts
const sequence = wardic.animate([
  [ball, { x: 10 }],
  [(value) => draw(value), [0, 1], { at: 0 }], // draw throws for a frame or two
])
// before: the sequence stayed "running" for good, and its callback was told nothing more
// now: it's told each frame's value, the sequence finishes, and "wardic.animate: a function Segment failed" is logged once
```

- **A function Segment's callback that throws** is logged once until it returns, and is still told each frame's value: its sequence lands as its stops do.
- **On `cancel()`,** a callback that throws as it's told its first stop is logged, and the rest of the call is still cancelled: nothing comes out of `cancel()`.
- **A `delay(i, n)` that throws** for a later Subject is an error at the call that takes nothing, as a key a Subject can't take is. Before, the earlier Subjects had already taken their keys from the animations running them.
