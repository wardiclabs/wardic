---
"@wardic/core": patch
---

A Batch's step writes only the members it moves, and those whose values a change outside a step set (one entering, a new Subject, a start from a given value, a play, seek, stop or cancel). A member waiting out a stagger's delay, or held by a paused Playhead, is no longer written each frame: on the DOM, a frame of 1,000 staggered members costs about a third less, and a paused one about three quarters less.
