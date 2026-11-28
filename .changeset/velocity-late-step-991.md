---
"@wardic/core": patch
"@wardic/solid": patch
---

A velocity over a value that moves on its own, a `follow`, a `spring` or another velocity, now reads its speed (#991). Before, it read 0 on every frame its source moved, while one over a value an app sets read the right speed.

```ts
const followed = yield* LiveValue.follow(source, { type: "tween", duration: 0.5, ease: "linear" })
const speed = yield* LiveValue.velocity(followed)
registry.set(source, 100)
// before: speed 0, 0, 0, …
// now: 200 a second each frame it moves, then 0 once it rests
```

- **The same for every binding's velocity:** Solid's `createVelocity` over `createFollowValue` or `createSpring`, and a velocity of a velocity (acceleration), which read 0 too.
