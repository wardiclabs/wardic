---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

The lift's fifth move (#672): the Batch, `animate` and presence move out of `@wardic/solid` into `@wardic/dom`, with no change an app or a Solid binding author sees. dom gains `unstable/BatchMembers`, `unstable/MemberHold`, `unstable/Imperative`, `unstable/PresenceController` (with the DOM's presence types), `unstable/ElementSetup`, `unstable/DragDefaults`, `unstable/AppearAnimations` and `unstable/ServerInterpolators`. Core's `unstable/WardicServices` Runner gains `runSyncExit`, which a `ManagedRuntime` already has. `unstable/` modules are for Wardic's own packages: public, with no semver promise.
