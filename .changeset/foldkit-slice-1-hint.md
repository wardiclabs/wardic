---
"@wardic/core": patch
"@wardic/test": patch
---

The Frame loop takes a binding's hint (`FrameLoop`'s `hint(frameTime)`, ADR-0071 decision 32): code that runs inside a Refresh frame after the frame's tick, as Foldkit's patch does, says so, and the runs it then adds take their first step in that frame instead of the next. For it, the Clock exposes the last tick's Refresh frame time (`frameAt`), on `DomLive`'s Clock and `@wardic/test`'s.
