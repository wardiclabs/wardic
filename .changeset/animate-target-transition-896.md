---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/object": patch
"@wardic/three": patch
---

`animate(subject, target, options)` now honours its target's own `transition` and `transitionEnd` (#896), on every Environment: the DOM's elements, plain objects, and three's scenes.

- **The target's `transition`** runs, with the options' fields laid over it: `animate(el, { x: 100, transition: { duration: 1 } }, { delay: 0.2 })` runs a 1 s tween after 0.2 s. Motion's `animate` reads the options alone.
- **Its `transitionEnd`** is set on each subject once that subject lands, so `await animate(o, { v: 1, transitionEnd: { v: 5 } })` sees 5, as `onComplete` does. A subject stopped, cancelled or taken over before it lands never sets it; `complete()` does. A cancel, a seek before its end or a replay after it's set puts it back, unless a later animation has set the key since, and the next landing sets it again.
