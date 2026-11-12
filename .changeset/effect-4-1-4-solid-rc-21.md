---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
"@wardic/test": patch
---

Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
