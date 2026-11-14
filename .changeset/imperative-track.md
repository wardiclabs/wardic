---
"@wardic/solid": patch
---

An app that never animates imperatively ships none of the code that does: an Imperative animation's track (`createAnimate`'s `animate`, and the Playback controls it returns) is built by the module that runs it, not by every Wardic element. Every app with a Wardic element and no `createAnimate` is 0.5–0.9% smaller: a Slim element's app 0.8 KB gzipped on Solid 1, 0.7 on Solid 2. An app that uses `createAnimate` is 0.4 KB larger.
