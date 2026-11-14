---
"@wardic/solid": patch
---

On Solid 2, a Wardic instance's ward is still a `Ward`: an app's `Array<Ward>`, or a helper's `(card: Ward) => …`, takes one from the instance's `w.ward()` or from a `wardRef` callback, and the instance's own `next`, `each` and `when` still reject another Feature's event, naming it.
