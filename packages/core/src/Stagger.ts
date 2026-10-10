/**
 * The `Stagger` module: a per-child delay, growing from an origin across a set of children
 * (ADR-0007).
 */
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type * as Easing from "./Easing.ts"

/** Where a stagger originates within the set of children. */
export type Origin = "first" | "last" | "center" | number

/** A stagger's options. */
export interface Options {
  /** Origin index the delay grows outward from. Default `"first"`. */
  readonly from?: Origin
  /** Optional easing applied across the index distribution. */
  readonly ease?: Easing.Easing
}

const resolveOrigin = (from: Origin, total: number): number =>
  Match.value(from).pipe(
    Match.when("first", () => 0),
    Match.when("last", () => total - 1),
    Match.when("center", () => (total - 1) / 2),
    Match.orElse((index) => index),
  )

/**
 * Builds a per-child delay function: `(index, total) => delaySeconds`. Delay
 * grows with distance from the origin; an optional easing reshapes the curve.
 *
 * ```ts
 * const d = Stagger.make(0.05, { from: "center" })
 * d(0, 5) // delay for the first child
 * ```
 */
export const make = (
  amount: number,
  options: Options = {},
): ((index: number, total: number) => number) => {
  const { from = "first", ease } = options
  return (index, total) => {
    const origin = resolveOrigin(from, total)
    const dist = Math.abs(origin - index)
    return Option.match(Option.fromUndefinedOr(ease), {
      onNone: () => amount * dist,
      onSome: (easing) => {
        const max = Math.max(1, total - 1)
        return amount * easing(dist / max) * max
      },
    })
  }
}
