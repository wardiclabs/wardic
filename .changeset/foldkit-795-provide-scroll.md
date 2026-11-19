---
"@wardic/foldkit": patch
---

`Wardic.scroll(options)`: a container's scroll as Live values (Motion's `useScroll`), on the Handle's `scroll` Feature, now exported as `Features.scroll`; without the Feature it fails with `ScrollFailed`. Core's `LiveValue.scroll` under `Wardic.provide` had no way to that Feature's service (#795).
