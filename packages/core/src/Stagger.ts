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

/** Where a stagger grows from, as a function of the count: chosen once, at `make`. */
const originOf: (from: Origin) => (total: number) => number = /*#__PURE__*/ Match.type<Origin>().pipe(
  Match.when("first", () => () => 0),
  Match.when("last", () => (total: number) => total - 1),
  Match.when("center", () => (total: number) => (total - 1) / 2),
  Match.orElse((index) => () => index),
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
// last child. The origin and the easing are resolved here, once, and the delay is plain arithmetic: it
// runs for each child of each orchestration (#618, H1).
export const make = (
  amount: number,
  options: Options = {},
): ((index: number, total: number) => number) => {
  const { from = "first", startDelay = 0 } = options
  const origin = originOf(from)
  // A name or a bézier's numbers to its curve (#360).
  return UndefinedOr.match(UndefinedOr.map(options.ease, Easing.resolve), {
    onUndefined: () => (index: number, total: number) => startDelay + amount * Math.abs(origin(total) - index),
    onDefined: (easing) => (index: number, total: number) => {
      const max = amount * total
      if (max === 0) return startDelay
      return startDelay + easing((amount * Math.abs(origin(total) - index)) / max) * max
    },
  })
}
