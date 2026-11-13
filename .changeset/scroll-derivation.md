---
"@wardic/core": minor
---

`LiveValue.scrollDerivationOf(atom)` describes how a Live value derives from a container's scroll: the scroll's options, whether it reads how far the container is scrolled or its progress, on which axis, and each `transform` it went through, with its ranges as given. `scroll`'s four values carry one, and so does each `transform` over them; a `spring` or a `velocity` of one doesn't. An Environment reads it to run the value on a native scroll timeline, a Timeline value, where it can.
