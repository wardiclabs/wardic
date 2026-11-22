---
"@wardic/solid": minor
"@wardic/core": patch
---

`createFrameEffect(compute, apply)` (#884): your own code in Wardic's frame, after its writes and before paint. The compute reads Live values and signals, tracked; the apply runs in the frame that moved what the compute read, given its value, and what it returns runs before the next apply and when its owner is disposed. Frame effects run in the order they were made. Solid's own `createEffect` runs after the frame is painted, so a write there shows a frame late. Solid 2 only.

Core's `@wardic/core/unstable/FrameEffects` gains `onFrameLoop`: an Environment's Frame effects on core's Frame loop, run at the end of each tick after the Flush gate's flush, and on a Refresh frame of their own when nothing animates.
