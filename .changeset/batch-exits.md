---
"@wardic/core": minor
"@wardic/solid": minor
---

A keyed `createBatch`'s members exit under `<AnimatePresence>`: `exit: { opacity: 0, transition: { duration: 0.2, delay: stagger(0.03) } }`, or `(item, i, custom) => values`, each leaving element kept on the page until its own exit lands, the members leaving together staggered by their rank among them. An item back while it exits takes its member over where it was, at its speed, its old element gone at once, and `initial={false}` starts the presence's first members at their targets. Core's Batch gains `onMemberLanded`, a driven change's landing member by member; a presence hook's `release(false)` lets its child go at once, uncompleted.
