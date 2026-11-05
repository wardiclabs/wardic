/**
 * Delays that grow across a set of children, from the first, the last, the centre or any index: what a
 * transition's `delayChildren: stagger()` and `createAnimate`'s `delay` run on. Motion's `stagger`.
 *
 * @example
 * import * as Stagger from "@wardic/core/Stagger"
 *
 * const delay = Stagger.make(0.05, { from: "center" })
 * delay(0, 5) // 0.1: the first of five is two steps from the centre
 */
// ADR-0007.
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Easing from "./Easing.ts"

/** The child a stagger grows from: `"first"`, `"last"`, `"center"`, or an index. */
export type Origin = "first" | "last" | "center" | number

/** A stagger's options, as Motion's `stagger`'s. */
export interface Options {
  /** Seconds before the first child's delay: every delay starts from it. Default 0. */
  readonly startDelay?: number
  /** The child the delay grows from. Default `"first"`. */
  readonly from?: Origin
  /**
   * How the delay grows across the children, eased across `amount × total`: an easing's name, a cubic
   * Bézier's four numbers, or a function. Default linear.
   */
  // #360, #436: Motion's `stagger`'s `ease`.
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
 * A stagger: a child's delay in seconds from its index and the count, `startDelay` plus `amount` for
 * each step from `from`. With `ease`, the steps are eased across `amount × total`, as Motion's.
 *
 * @example
 * const delay = Stagger.make(0.1, { from: "last", ease: "easeOut" })
 * const delays = [0, 1, 2, 3].map((i) => delay(i, 4))
 */
// Motion's `stagger` (#436); with an easing, `amount × total` is Motion's `maxDelay`, one step past the
// last child.
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
