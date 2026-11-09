---
"@wardic/core": patch
"@wardic/dom": patch
---

An animation that starts after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its starting value for one frame. That covers an animation an `onAnimationComplete` callback starts, a `when: "beforeChildren"` variant's children, the child that enters after `<AnimatePresence mode="wait">`'s exit, and, on Solid 2, what an effect starts when it reacts to an animation landing. A layout change Solid 2 makes in those effects moves in that frame too. An animation started from a later `requestAnimationFrame` callback, or after an `await`, still starts moving at the next frame.
