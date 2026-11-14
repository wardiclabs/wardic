---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

An app ships less of what it never calls: `Renderer.applyTo`, `Machine.nextFrame`, `DefaultTransition.layerOneSpring`, the FlushGate's `inert` and `layerInert`, a Reorder group's touch action and three of a Batch's predicates are marked pure, so a bundler drops them from an app that doesn't use them. A Slim element's app is 0.3 KB gzipped smaller on Solid 1, 0.4 on Solid 2.
