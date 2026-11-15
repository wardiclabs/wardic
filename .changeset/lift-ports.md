---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
"@wardic/test": patch
---

The lift's second move (#672): Wardic's spine reads a Subject's own values, Measured pairs and Variable values through three new, optional Environment members, `@wardic/core/unstable/OwnValues`, `MeasuredPairs` and `VariableValues`, instead of reading the DOM itself. `DomLive` gives none: a DOM binding falls back to the DOM's (`@wardic/dom/unstable/DomValues`), so an app on `DomLive` sees no change, and an app with no Wardic element ships none of them. `@wardic/test`'s `TestLive` gives headless ones: under it the spine no longer reads the DOM, so a value keeps its own type with no units read, and no pair is measured nor `var()` resolved.
