---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/object": patch
"@wardic/foldkit": patch
---

An animation a later one takes a key from mid-flight now ends without landing (#951), on every Environment, Batch calls and sequences included. A key taken after it landed, or one that snaps (`skipAnimations`, reduced motion), doesn't count, as in Motion.

- **As in Motion,** its promise never resolves and its `onComplete` never comes.
- **Once the keys it still draws have landed,** or at once when none are left, its `state` reads `"idle"`, as after a `stop()`. A scope's `settled()` stops waiting on it, `scope.animations` drops it, and a Foldkit `Wardic.animate` Command succeeds with `{ landed: false }`. Before, it landed with its other keys, or, with every key taken, stayed `"running"` for good.
- **A seek, `complete()` or replay before its end** takes its keys back from whatever draws them, where it left the later animation drawing them too.
- **An element's own target carrying an animation's leg on** (its new target the leg's) ends that animation without landing, where it stayed `"running"` for good.
