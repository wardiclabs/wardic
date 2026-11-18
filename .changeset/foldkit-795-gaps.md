---
"@wardic/foldkit": patch
---

What the storefront's Foldkit app asked of the binding (#795): `w.LayoutCrossfade(false)`, so a `LayoutId` handover flies one element instead of blending two; `arc()`, `correctParentTransform` and `transformViewBoxPoint` from the root and from `Wardic`, the last two given an element as a selector, since a Foldkit view has no refs.
