/**
 * The `Stagger` module: a per-child delay, growing from an origin across a set of children
 * (ADR-0007).
 */
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Easing from "./Easing.ts"

/** Where a stagger originates within the set of children. */
export type Origin = "first" | "last" | "center" | number

/** A stagger's options, Motion's `stagger`'s. */
export interface Options {
  /** Seconds before the first delay: every child's delay starts from it (#436). Default 0. */
  readonly startDelay?: number
  /** Origin index the delay grows outward from. Default `"first"`. */
  readonly from?: Origin
  /**
   * How the delay grows across the children: an Easing definition (#360), Motion's `stagger`'s
   * `ease`, across `amount × total` as Motion's (#436). Default linear.
   */
  readonly ease?: Easing.Definition
}

const resolveOrigin = (from: Origin, total: number): number =>
  Match.value(from).pipe(
    Match.when("first", () => 0),
    Match.when("last", () => total - 1),
    Match.when("center", () => (total - 1) / 2),
    Match.orElse((index) => index),
  )

/**
 * Builds a per-child delay function, `(index, total) => delaySeconds`, Motion's `stagger` (#436):
 * `startDelay` plus `amount` for each step from the origin. An easing reshapes the curve across
 * `amount × total`, Motion's `maxDelay`, one step past the last child.
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
  const { from = "first", startDelay = 0 } = options
  // Resolved once, here: a name or a bézier's numbers to its curve (#360).
  const ease = UndefinedOr.map(options.ease, Easing.resolve)
  return (index, total) => {
    const origin = resolveOrigin(from, total)
    const delay = amount * Math.abs(origin - index)
    return startDelay + Option.match(Option.fromUndefinedOr(ease), {
      onNone: () => delay,
      onSome: (easing) => {
        const max = amount * total
        if (max === 0) return 0
        return easing(delay / max) * max
      },
    })
  }
}
