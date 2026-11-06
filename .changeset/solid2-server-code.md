---
"@wardic/solid": patch
---

A Solid 2 app's client bundle no longer carries the server render's code: about 8 KB gzipped less in every app (the Slim element's, 132.3 → 123.9 KB). The provider chose its server or client side through a call a bundler can't see through, so both shipped.
