---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

The lift's sixth and last move (#672): the Features move out of `@wardic/solid` into `@wardic/dom`, with no change an app or a Solid binding author sees. dom gains `unstable/Feature`, `unstable/GestureFeatures`, `unstable/Press`, `unstable/OwnerScope`, `unstable/Instant`, `unstable/DragTrack`, `unstable/DragTransition`, `unstable/LayoutMember`, `unstable/LayoutGroup` and the Features' folder, `unstable/features/<Name>`. A Feature registry runs on core's Runner. `unstable/` modules are for Wardic's own packages: public, with no semver promise.
