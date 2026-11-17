---
"@wardic/core": patch
"@wardic/test": patch
---

The Frame loop takes a binding's hint (`FrameLoop`'s `hint(frameTime)`, ADR-0071 decision 32): a binding whose code runs inside a Refresh frame after the frame's tick, rendering in a frame callback of its own, says so, and the runs it then adds take their first step in that frame instead of the next. For it, the Clock exposes the last tick's Refresh frame time (`frameAt`), on every Clock the packages ship.
