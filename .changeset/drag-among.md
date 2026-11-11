---
"@wardic/core": minor
---

`DragRecognizer.watchDragAmong(memberOf, options, handlers)` watches drags among many members from one feed over them, as `Recognizer.watchHoverAmong` and `watchPressAmong` watch hovers and presses: a member's press starts a drag of that member alone, with `watchDrag`'s threshold, claim, samples and velocity, and no member listens until it's pressed. A member's watch ends with its gesture, at its own end, so a real pointer's release, which the browser tells the feed over the members first, still ends it.
