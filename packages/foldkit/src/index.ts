/**
 * @wardic/foldkit — Wardic for Foldkit (ADR-0071, #561): Motion's animations on Foldkit's views, as
 * Effect. `Wardic.make({ env })` makes a Handle once per program; `wardic.html(h)` gives a view its
 * `w.*` elements. Private until 1.2 (#791).
 */
export const VERSION = "1.1.2"

export * as Wardic from "./Wardic.ts"
export * as Ward from "./Ward.ts"
// Core's Live values (ADR-0043) and the stagger helper, so an app imports nothing from `@wardic/core` (#791, Q13).
export * as LiveValue from "@wardic/core/LiveValue"
export { stagger } from "./Wardic.ts"
