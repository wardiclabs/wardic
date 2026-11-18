---
"@wardic/dom": patch
---

Three of `Imperative`'s exported for a binding whose `animate` is its own (#798): `isSequence`, whether what `animate` was given is a sequence rather than a subject; `segmentAnimates`, whether a Segment animates anything under a scope; and `alsoTold`, a watch with another told after it, which the scope's own watch is now built on.
