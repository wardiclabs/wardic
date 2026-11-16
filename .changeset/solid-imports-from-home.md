---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

Solid's own modules import core and dom from their homes (#777), with no change an app or a Solid binding author sees. The one-line re-exports the lift (#672) left at `@wardic/solid`'s old paths are gone, and both entries export the same names and types; core's and dom's comments that named them name their readers now.
