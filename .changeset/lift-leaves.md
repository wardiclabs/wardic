---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

The lift's third move (#672): the spine's leaves move out of `@wardic/solid`, with no change an app or a Solid binding author sees. Core gains `unstable/PresenceRecord`, `unstable/VariantTarget`, `unstable/WardicConfigValue`, `unstable/FrameTime`, `unstable/RetargetLegs` and `unstable/Subject`; dom gains `unstable/LiveStyle`, the Live values routed through an element's `style`. `unstable/` modules are for Wardic's own packages: public, with no semver promise.
