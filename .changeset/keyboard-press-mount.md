---
"@wardic/dom": minor
"@wardic/solid": patch
---

A Batch with `whileTap` or a tap event mounts faster, about 0.3 ms less per 1,000 members, back within a plain Batch's mount. Each member's element is still made focusable as it arrives (`tabindex="0"` unless it takes focus of itself), but the Batch now makes it so directly, not through its lazily loaded gesture code, and the check reads only what it needs, for every Wardic element with a press too. `@wardic/dom/KeyboardPress` is new: its `makeFocusable` is `DomInput.makeFocusable`, in a module of its own, so a binding can call it without loading the DOM's input.
