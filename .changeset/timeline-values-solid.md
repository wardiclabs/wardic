---
"@wardic/solid": minor
---

A scroll value from `createScroll`, or a `createTransform` of one through ranges, given to an element's `opacity`, `filter`, `clipPath`, `transform` or a transform key alone in it, is now drawn by the browser with the scroll itself where it has native scroll timelines (Chrome and Edge 115+, Safari 26+, Firefox 159+), so it no longer trails a touch fling or a busy page by a frame or more. It's automatic, and everywhere else, and for a function, a spring or a velocity of a scroll, Wardic draws the value as before. An `animate` target or a gesture that sets the key takes it back while it sets it, and an `animate()` call keeps it where it leaves it. The element's inline style is still written, its `onUpdate` still told, and `getAnimations()` lists the scroll-driven animation. Solid 1's `createScroll` values now carry an Atom each, as Solid 2's do, and `createTransform` through ranges over a value that carries one derives on it, in both bindings.
