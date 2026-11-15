---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

The first of the lift's six moves (#672): code a second binding needs moves out of `@wardic/solid` into public `unstable/` modules of core and dom, with no change an app or a Solid binding author sees. Core gains `unstable/Report`, `unstable/Stops`, `unstable/WardicServices` (the services an Environment gives, and the Runner), `unstable/Reactivity` and `unstable/Config`; dom gains `unstable/WardConfig`, `unstable/GestureInfo`, `unstable/DragControls` and `unstable/DragConstraints`. `unstable/` modules are for Wardic's own packages: public, with no semver promise. `@wardic/dom` now depends on `csstype`, whose types its config types are built on.
