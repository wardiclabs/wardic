/**
 * The `Flip` module: FLIP's Invert as pure geometry (ADR-0004, ADR-0005).
 */
import * as Bool from "effect/Boolean"
import type * as Probe from "./Probe.ts"

/**
 * The transform a FLIP animation interpolates: a translation (`x`, `y`) and a
 * per-axis scale (`scaleX`, `scaleY`). Identity is {@link IDENTITY}
 * (`{ x: 0, y: 0, scaleX: 1, scaleY: 1 }`) — the element sitting at its real,
 * post-layout box.
 */
export interface Transform {
  readonly x: number
  readonly y: number
  readonly scaleX: number
  readonly scaleY: number
}

/** The resting transform — the element at its measured `to` box, untransformed. */
export const IDENTITY: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }

/** `from`'s size over `to`'s, or 1 for a zero-sized `to` rather than `Infinity` / `NaN`. */
const sizeRatio = (from: number, to: number): number =>
  Bool.match(to === 0, { onTrue: () => 1, onFalse: () => from / to })

/**
 * The "Invert" half of FLIP, as pure geometry (see ADR-0004 / ADR-0005): given
 * the element's prior box (`from`) and its current box (`to`), return the
 * transform that visually places it back at `from` while it actually occupies
 * `to`. Animating this result toward {@link IDENTITY} — via
 * `animateValues` / `springValues`, or the binding's spring spine — "Plays" the
 * element from `from` to `to`. Core owns this Invert math; the Play is
 * composition and the *when-to-measure* is the binding's (ADR-0005).
 *
 * Translation is measured from the boxes' top-left; scale is the size ratio,
 * guarded so a zero-sized `to` yields scale `1` rather than `Infinity`/`NaN`.
 */
export const make = (from: Probe.Bounds, to: Probe.Bounds): Transform => ({
  x: from.left - to.left,
  y: from.top - to.top,
  scaleX: sizeRatio(from.width, to.width),
  scaleY: sizeRatio(from.height, to.height),
})
