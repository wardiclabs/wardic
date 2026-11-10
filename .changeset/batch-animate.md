---
"@wardic/core": minor
"@wardic/solid": minor
---

`createAnimate`'s `animate` takes a Batch, or one member's handle, and returns the same Playback controls an element's call returns: `await` it, pause it, seek its `time`, change its `speed`, `complete`, `cancel` or `stop` it. Each key takes a number for every member, two stops (its first and its target), or a function of the member's index and the Batch's count that gives one or two, so `animate(grid, { x: (i) => colX(i) }, { delay: stagger(0.002) })` moves a thousand members as one call. A later change of a member's key takes it, as a Wardic element's does: that member goes the later change's way, and the call it left doesn't finish. Core's Batch gains `animate`, `play`, `stop`, `cancel` and `durationOf`: a change driven by a Playhead, which lands frame for frame as the change would, backwards too.
