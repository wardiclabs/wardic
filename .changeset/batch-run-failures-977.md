---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/object": patch
"@wardic/three": patch
---

One member whose write fails no longer stops its Batch (#977). Before, a member that threw while its Batch drew it ended the Batch's run, so every member stopped where it was and every call on the Batch stayed `"running"`, with nothing logged.

```ts
const dots = [{ x: 0 }, { x: 0 }]
const swarm = wardic.batch(dots)
wardic.animate(swarm, { x: 100 })
Object.freeze(dots[0]) // a few frames in
// before: dots[1] stopped where it was, and the call never finished
// now: dots[1] lands; "wardic.batch: a member's write failed" is logged once
```

- **Each member's own:** a write, or a start taken over from a server's Appear animation, that throws is logged once until every member steps clean. That member moves on with the others, and lands with them.
- **An `onComplete` runs once its call has finished.** One that throws is logged each time it lands, and the call stays `"finished"`: its `await` resolves and `play()` plays it again. Before, a throwing `onComplete` left any call `"running"` for good, and on a Batch it stopped the run.
- **A member's landing,** a keyed exit's for one, that throws is logged, and the other members still land.
- **On the DOM,** an element with no inline style (one of a foreign namespace) is an error naming it when it's given to a Batch, before it joins. One member's Handoff read or release that throws leaves the other members' alone.
