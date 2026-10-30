/**
 * The `Arc` module: curved paths between two points (#438), Motion's `arc()`. A path is what a
 * transition's `path` takes: from where `x` and `y` start to where they end, the point at each
 * progress, so the two travel along a curve together rather than a straight line. An arc is a
 * quadratic Bézier bulging off the straight line between them.
 */
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Point from "./Point.ts"

/** A point along a path: where `x` and `y` are, and, for a path that turns the element, its angle in degrees. */
export interface PathPoint extends Point.Point {
  readonly rotate?: number | undefined
}

/**
 * A path for `x` and `y` (#438): from where they start to where they end, the point at progress `t`,
 * 0 at the start, 1 at the end. Open: `arc` makes one, and any function of this shape is one.
 */
export type Path = (from: Point.Point, to: Point.Point) => (t: number) => PathPoint

/** An arc's options, Motion's `arc`'s. */
export interface Options {
  /**
   * How far the arc bulges off the straight line, as a share of the distance it travels: `1` peaks
   * at the whole distance. Default `0.5`.
   */
  readonly strength?: number | undefined
  /** Where along the way (0–1) the arc is at its highest. Default `0.5`. */
  readonly peak?: number | undefined
  /**
   * The side it bulges to, turning with the direction of travel: `"cw"` or `"ccw"`. Left out, it
   * keeps to one side of the screen across the paths one arc makes.
   */
  readonly direction?: "cw" | "ccw" | undefined
  /** Whether it turns the element to follow the curve: `true` all the way, a number 0–1 that share of it. */
  readonly rotate?: boolean | number | undefined
}

/** `value` wrapped into `[min, max)`, motion-utils' `wrap`. */
const wrap = (min: number, max: number, value: number): number => {
  const range = max - min
  return ((((value - min) % range) + range) % range) + min
}

/** A quadratic Bézier's coordinate at `t`. */
const bezierAt = (t: number, origin: number, control: number, target: number): number => {
  const inv = 1 - t
  return inv * inv * origin + 2 * inv * t * control + t * t * target
}

/** The angle (degrees) of a quadratic Bézier's tangent at `t`. */
const tangentAt = (t: number, from: Point.Point, control: Point.Point, to: Point.Point): number => {
  const dx = 2 * (1 - t) * (control.x - from.x) + 2 * t * (to.x - control.x)
  const dy = 2 * (1 - t) * (control.y - from.y) + 2 * t * (to.y - control.y)
  return Math.atan2(dy, dx) * (180 / Math.PI)
}

/** The arc's control point: `peak` along the straight line, `strength` of its length off it, to its left. */
const controlOf = (from: Point.Point, to: Point.Point, strength: number, peak: number): Point.Point => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  if (distance === 0) return from
  const height = strength * distance
  return { x: from.x + dx * peak - (dy / distance) * height, y: from.y + dy * peak + (dx / distance) * height }
}

/** How much of the tangent an arc turns the element by. */
const rotationOf = (rotate: boolean | number | undefined): number =>
  Match.value(rotate).pipe(
    Match.when(true, () => 1),
    Match.when(Match.number, (share) => share),
    Match.orElse(() => 0),
  )

/**
 * A curved path, Motion's `arc` (#438), for a transition's `path`:
 *
 * ```ts
 * const path = Arc.make({ strength: 0.3 })
 * // transition={{ path }}: x and y travel along it together
 * ```
 *
 * Make one and keep it (a component's body runs once): with no `direction`, it remembers the side of
 * the screen it bulged to, and keeps to it when the direction of travel turns.
 */
export const make = (options: Options = {}): Path => {
  const strength = UndefinedOr.match(options.strength, { onUndefined: () => 0.5, onDefined: identity })
  const peak = UndefinedOr.match(options.peak, { onUndefined: () => 0.5, onDefined: identity })
  const direction = options.direction
  const rotation = rotationOf(options.rotate)
  // With no direction: the side of the screen the last arc bulged to, across the paths this one makes.
  let lastSide: number | undefined
  return (from, to) => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const signed = Match.value(direction).pipe(
      Match.when("cw", () => -strength),
      Match.when("ccw", () => strength),
      // Toward the screen side that keeps the dominant axis's travel turning the same way.
      Match.orElse(() =>
        Bool.match(Bool.match(Math.abs(dx) >= Math.abs(dy), { onTrue: () => dx, onFalse: () => dy }) < 0, {
          onTrue: () => -strength,
          onFalse: () => strength,
        })),
    )
    let control = controlOf(from, to, signed, peak)
    if (Predicate.isUndefined(direction)) {
      // Which side of the straight line it bulges to, across the dominant axis.
      const side = Math.sign(
        Bool.match(Math.abs(dx) < Math.abs(dy), { onTrue: () => control.x - (from.x + dx * peak), onFalse: () => control.y - (from.y + dy * peak) }),
      )
      // The other side from the last arc's: turned back onto it.
      const turned = Bool.and(Bool.and(Predicate.isNotUndefined(lastSide), side !== 0), side !== lastSide)
      if (turned) control = controlOf(from, to, -signed, peak)
      if (Bool.and(side !== 0, Bool.not(turned))) lastSide = side
    }
    if (rotation === 0) return (t) => ({ x: bezierAt(t, from.x, control.x, to.x), y: bezierAt(t, from.y, control.y, to.y) })
    // The turn is measured from the straight turn between the tangents at the ends, so it's 0 at both.
    const start = tangentAt(0, from, control, to)
    const turn = wrap(-180, 180, tangentAt(1, from, control, to) - start)
    return (t) => ({
      x: bezierAt(t, from.x, control.x, to.x),
      y: bezierAt(t, from.y, control.y, to.y),
      rotate: wrap(-180, 180, tangentAt(t, from, control, to) - (start + turn * t)) * rotation,
    })
  }
}
