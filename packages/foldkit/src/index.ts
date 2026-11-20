/**
 * @wardic/foldkit — Wardic for Foldkit (ADR-0071, #561): Motion's animations on Foldkit's views, as
 * Effect. `Wardic.make({ env })` makes a Handle once per program; `wardic.html(h)` gives a view its
 * `w.*` elements. Shipped from 1.2 (#561).
 */
export const VERSION = "1.2.0"

export * as Wardic from "./Wardic.ts"
export * as Ward from "./Ward.ts"
// The Features a Handle takes (#792, Q16): dom's, and the binding's own `presence`.
export * as Features from "./Features.ts"
// Drag controls (#431; #793, Q8): made apart from the elements they drive.
export * as DragControls from "./DragControls.ts"
// Animation controls (#433; #798): made apart from the elements they drive, started from a Command.
export * as AnimationControls from "./AnimationControls.ts"
// Animation scopes (#433; #798): what a Command's selectors resolve under, and whose element's release stops its animations.
export * as AnimationScope from "./AnimationScope.ts"
// Core's Live values (ADR-0043) and the helpers Solid's root has, so an app imports nothing from `@wardic/core` or `@wardic/dom` (#791, Q13; #795).
export * as LiveValue from "@wardic/core/LiveValue"
export { arc, correctParentTransform, stagger, transformViewBoxPoint } from "./Wardic.ts"
