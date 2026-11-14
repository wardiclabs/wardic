---
"@wardic/core": patch
"@wardic/dom": patch
---

The Frame loop and the DOM's services hold their fibers themselves: a Slim element's app, and an app with only the hover, press, focus or in-view gestures, ships none of Effect's `FiberHandle` and `FiberSet`, 0.7 KB gzipped smaller on Solid 1 and 0.8 on Solid 2. An app whose layout, drag or Live values (a follow value, `createVelocity`, `createTime`, `createAnimationFrame`) use them still ships them.
