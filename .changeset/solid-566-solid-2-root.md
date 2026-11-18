---
"@wardic/solid": major
---

Solid 2's binding is `@wardic/solid`'s root (#566). Solid 2 is stable, so its binding leaves `unstable/`, its API under semver as it was. Solid 1's binding moves to `@wardic/solid/v1`, deprecated and frozen for features: a Solid 1 app changes its imports from `@wardic/solid` to `@wardic/solid/v1`, and it's removed at Wardic's next major. `@wardic/solid/unstable/v2` re-exports the root, deprecated, until then. Every name both deprecated entries export is marked `@deprecated`, so an editor flags the import. `@wardic/solid` now versions on its own, apart from `@wardic/core`, `@wardic/dom` and `@wardic/test`, and depends on the exact `@wardic/core` and `@wardic/dom` it's built with.
