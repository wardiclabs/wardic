/**
 * `arc()` (#438, Motion's): a curved Path for a transition's `path`, `x` and `y` travelling along it
 * together. Solid-free, on both bindings.
 *
 * @module
 */
import * as Arc from "@wardic/core/Arc"
import type { WardicPath } from "./config.ts"

/** `arc()`'s options (Motion's `ArcOptions`). */
export interface WardicArcOptions {
  /** How far it bulges off the straight line, as a share of the distance: `1` peaks at the whole distance. Default 0.5. */
  readonly strength?: number
  /** Where along the way (0–1) it's highest. Default 0.5. */
  readonly peak?: number
  /** The side it bulges to, turning with the direction of travel. Left out, it keeps to one side of the screen. */
  readonly direction?: "cw" | "ccw"
  /** Whether it turns the element to follow the curve: `true` all the way, a number 0–1 that share of it. */
  readonly rotate?: boolean | number
}

/**
 * A curved path for a transition: `x` and `y` travel along a curve between where they start and their
 * target, on `x`'s transition, in place of two straight lines. Make it once, in a component's body or
 * at module level: with no `direction`, it remembers which side of the screen it bulged to. Motion's
 * `arc()`.
 *
 * @example
 * const path = arc({ strength: 0.4, rotate: true })
 * <w.div animate={{ x: 200, y: 80 }} transition={{ path, duration: 0.6 }} />
 * @see https://wardic.dev/reference/solid/transitions/arc
 */
// #438.
export const arc = (options: WardicArcOptions = {}): WardicPath => Arc.make(options)
