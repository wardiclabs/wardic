---
"@wardic/solid": patch
---

A child exiting in an `<AnimatePresence>` keeps its place in Motion's order when the list is reordered during its exit. It used to stay where it was, between the moved items, until its exit ended: `[a, b, c]` to `[a, c]`, then `[c, a]` while b fades out, drew `c b a`, where Motion draws `c a b`. On Solid 1 one exiting child was enough. On Solid 2 it took two. Under `mode="popLayout"` too. A list emptied beside a sibling element, such as a footer item after the presence, also keeps its exiting children before that sibling now, where they could land after it.
