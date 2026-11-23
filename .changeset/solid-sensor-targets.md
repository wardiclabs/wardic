---
"@wardic/solid": minor
---

The gesture sensors take what they read first (#884): `createHover(element)`, `createPress`, `createFocus` and `createDrag(element, options?)` read an element you already have, and give back their reading alone. Given a ward, `createHover(card)`, `createPress(card)` and `createDrag(card)` read the ward's own hover, press and drag, which its `when` would start, so nothing listens to its element twice; `createFocus(card)` follows the element the ward is on. The call form, a sensor given to a `ref`, is unchanged. Solid 2 only.
