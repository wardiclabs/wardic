---
"@wardic/dom": patch
---

A layout Measure pass no longer writes the transform of each element at rest. A pass that moves nothing, which follows most changes in an app, such as one row's text, wrote every layout element's transform twice and made the browser recalculate their style. At 1,000 layout elements it now takes about half the time in Chromium and a third in Firefox, and Solid's layout benchmark measures 57–61% faster. An element is measured at `transform: none`, as Motion measures it: a stylesheet's `transform` on a layout element is left out of its measured box, as it's left out of what Wardic draws at rest.
