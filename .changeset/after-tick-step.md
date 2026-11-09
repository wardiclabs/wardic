---
"@wardic/core": patch
"@wardic/dom": patch
---

A layout change that Wardic sees after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its old place for one frame. That covers content that grows (seen by Wardic's own ResizeObserver), an effect that runs as Wardic writes a frame, and a change made when a layout animation ends. Its first painted step is the same one a click makes. Wardic can't tell when your own ResizeObserver callback or a later `requestAnimationFrame` callback runs, so a change made there still starts moving at the next frame.
