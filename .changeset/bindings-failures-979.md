---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
"@wardic/foldkit": patch
---

An app's function that throws in a few more of the bindings' paths is now its own element's or its own call's (#979).

```tsx
<wardic.ul initial="closed" animate="open" variants={list} transition={{ delayChildren: (i) => delays[i].seconds }}>
  <For each={items()}>{() => <wardic.li variants={item} />}</For>
</wardic.ul>
// before: a `delayChildren` function that threw for one child halted Solid 2 at the change
// now: that child starts with no delay, the others with theirs, and "wardic.stagger: a delayChildren function failed" is logged once
```

- **A `delayChildren` function that throws** for one child, on every binding: that child starts with no delay and the others with theirs. Logged once a run of throws as `wardic.stagger: a delayChildren function failed`, with the child's index, and once for a presence's exit or a server render. Before, it halted Solid 2, came out of Solid 1's setter, and on Foldkit kept the later elements from that patch.
- **Animation controls' `start(fn)` and `set(fn)`:** a function that throws for one element refuses the call, as before, but no element has changed. Before, the earlier elements had already started. Foldkit's `AnimationControls.start` Command dies with the throw.
- **A scroll transform whose `ease` throws** where its native scroll animation's keyframes sample it runs no native animation: Wardic draws its key each frame instead. Logged once as `wardic.timeline: a Timeline value failed`, with its key. Before, it halted Solid 2, broke Solid 1's mount, and failed a Foldkit element's mount.
- **Solid 1's `createBatch` `onAnimationStart` and `onAnimationComplete`:** a callback that throws is logged each time as `createBatch: onAnimationStart failed` or `createBatch: onAnimationComplete failed`, and the members still move and land. Before, a start that threw kept them from moving at that change, and dropped the rest of Solid 1's update; a landing's throw was swallowed.
