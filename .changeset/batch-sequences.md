---
"@wardic/core": minor
"@wardic/solid": minor
---

A Batch can be a sequence's Segment: `animate([[grid, { y: [-40, null] }, { delay: stagger(0.01) }], [grid, { x: (i) => colX(order[i]) }, { at: "+0.2" }]])` moves each member through its own stops in the Batch, under the sequence's controls with its other Segments. A key takes a number, `null`, stops, or a function of the member's index and the Batch's count; a Segment's `stagger()` counts its members. A member's element in a Segment of elements moves its Batch keys in the Batch and the rest as any element's. Core's Batch gains `keyframes`, a driven change whose keys each run their own stops as `Machine.keyframes` runs them, and a Sequence's value can be a function of each subject's index and count. A driven change played from partway through now lands its first step there, as a driven machine does, and a tween's `durationOf` counts the frames its steps take, as `Machine.durationOf` does.
