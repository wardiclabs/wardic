---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

An app ships less code it never calls. A bundler kept a few of Wardic's module-level helpers and Layers in every app, whether it used them or not, among them `Renderer.applyTo`, `DefaultTransition.layerOneSpring` and `FlushGate.layerInert`; they're now marked so it drops them. A Slim element's app is 0.3 KB gzipped smaller on Solid 1 and 0.4 on Solid 2, and every app is a little smaller.
