/**
 * The `Point` module: a 2D point, `{ x, y }`, and its geometry. A plain shape (ADR-0028,
 * decision 1); drag's `Vec2`, the same shape, is a `Point`.
 */
import * as Scalar from "./Scalar.ts"

/** A 2D point, or a 2D vector (a drag offset, a velocity). */
export interface Point {
  readonly x: number
  readonly y: number
}

/** Euclidean distance between two points. */
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

/** Angle (radians) of the vector from `a` to `b`. */
export const angle = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x)

/** Component-wise linear interpolation between two points. */
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: Scalar.lerp(a.x, b.x, t),
  y: Scalar.lerp(a.y, b.y, t),
})
