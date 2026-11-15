---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

The lift's fourth move (#672): the spine and what it imports move out of `@wardic/solid`, with one type a binding author may see: `WardicVariantContextValue.appearGroup`, the server's Appear group a Variant child joins, is `unknown` (no export names its type). Core gains `unstable/Spine`, `unstable/FlushGate` (the gate, dom's Tier 2 `FlushGate` building it with the DOM's edges), `unstable/Timelines`, `unstable/VariantTree`, `unstable/AnimationControls` and `unstable/AppearHandoff`. dom's `unstable/LiveStyle` decides an element's will-change from the legs a Retarget starts (`started`). `unstable/` modules are for Wardic's own packages: public, with no semver promise.
