---
"@wardic/solid": patch
---

Hydrating elements look their Appear animations up in one read of the page each time it hydrates, where each element read its own. In Chromium, each element's read cost about as much as the whole page's, so a server-rendered list of a few hundred entering items took hundreds of milliseconds to hydrate. An element the server gave no Appear animation reads nothing, and an element in a shadow root, or a Batch's member there, reads its shadow root's.
