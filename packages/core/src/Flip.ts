/**
 * FLIP's "invert": the transform that draws an element back where it was, from its box before a layout
 * change and its box after. Animating it to `IDENTITY` plays the element from its old place to its new
 * one, while its layout is already the new one.
 *
 * @example
 * import * as Flip from "@wardic/core/Flip"
 *
 * const invert = Flip.make(before, after) // two measured `Probe.Bounds`
 * // Animate `invert` to `Flip.IDENTITY`.
 */
// ADR-0004, ADR-0005: core owns the invert math; the play is composition, and when to measure is the
// binding's.
import * as Bool from "effect/Boolean"
import type * as Probe from "./Probe.ts"

/** What a FLIP animation animates: a move and a scale on each axis. `IDENTITY` is the element at its new box. */
export interface Transform {
  /** The move across. */
  readonly x: number
  /** The move down. */
  readonly y: number
  /** The scale across. */
  readonly scaleX: number
  /** The scale down. */
  readonly scaleY: number
}

/** No move and no scale, `{ x: 0, y: 0, scaleX: 1, scaleY: 1 }`: the element drawn at its new box. */
export const IDENTITY: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }

/** `from`'s size over `to`'s, or 1 for a zero-sized `to` rather than `Infinity` / `NaN`. */
const sizeRatio = (from: number, to: number): number =>
  Bool.match(to === 0, { onTrue: () => 1, onFalse: () => from / to })

/**
 * The transform that draws a box at `to` where `from` was: the move from `to`'s top-left corner to
 * `from`'s, and the ratio of their sizes, 1 for a `to` of no size. Animate it to `IDENTITY`, with
 * `Machine.springValues` or `Machine.animateValues`, to play the element from `from` to `to`.
 */
// The zero-size guard keeps scale from `Infinity` or `NaN`.
export const make = (from: Probe.Bounds, to: Probe.Bounds): Transform => ({
  x: from.left - to.left,
  y: from.top - to.top,
  scaleX: sizeRatio(from.width, to.width),
  scaleY: sizeRatio(from.height, to.height),
})
