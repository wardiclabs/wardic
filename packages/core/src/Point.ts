/**
 * A 2D point, `{ x, y }`, or a vector, an offset or a velocity, and its geometry: `distance`, `angle`
 * and `lerp`. A plain object, so any `{ x, y }` is one.
 *
 * @example
 * import * as Point from "@wardic/core/Point"
 *
 * Point.distance({ x: 0, y: 0 }, { x: 3, y: 4 }) // 5
 */
// ADR-0028, decision 1: a plain shape; drag's `Vec2`, the same shape, is a `Point`.
import * as Scalar from "./Scalar.ts"

/** A 2D point, or a 2D vector (a drag offset, a velocity). */
export interface Point {
  /** Across. */
  readonly x: number
  /** Down. */
  readonly y: number
}

/** The distance between two points. */
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

/** The angle, in radians, of the line from `a` to `b`: 0 along `x`, π/2 along `y`. */
export const angle = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x)

/** The point `t` of the way from `a` to `b`: `a` at 0, `b` at 1. */
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: Scalar.lerp(a.x, b.x, t),
  y: Scalar.lerp(a.y, b.y, t),
})
