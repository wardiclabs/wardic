/**
 * Auto-scroll for a Reorder group, as Motion's: while an item is dragged near a scroller's edge, the
 * scroller scrolls toward it, faster the nearer. This is its math, one update on one axis at a time; the
 * binding measures the scroller, calls `step` at each move of the drag, and scrolls by what it says.
 *
 * @example
 * import * as AutoScroll from "@wardic/core/AutoScroll"
 *
 * let state = Option.none<AutoScroll.State>()
 * // At each move of the drag:
 * const next = AutoScroll.step(state, {
 *   pointer: point.y,
 *   start: visible.top,
 *   end: visible.bottom,
 *   velocity: velocity.y,
 *   scroll: offset,
 *   maxScroll: () => range,
 * })
 * scrollBy(next.amount)
 * state = next.state
 */
// ADR-0020: Motion's `autoScrollIfNeeded`, ported (Reorder/utils/auto-scroll.ts @ 16c6122). Effect-free
// and DOM-free. Tier 2 (ADR-0008): for binding and Environment authors.
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type * as Point from "./Point.ts"
import type * as Reorder from "./Reorder.ts"

/** How near a scroller's visible edge, in px, the pointer starts it scrolling: 50, as Motion's. */
// Motion's `threshold` (Reorder/utils/auto-scroll.ts:1 @ 16c6122).
export const THRESHOLD = 50

/** The most a scroller scrolls in one update, in px, with the pointer at its edge: 25, as Motion's. */
// Motion's `maxSpeed` (Reorder/utils/auto-scroll.ts:2 @ 16c6122).
export const MAX_SPEED = 25

/** The edge a scroller is scrolling toward, between one `step` and the next. */
export interface State {
  /** The edge: `"start"` at the top or left, `"end"` at the bottom or right. */
  readonly edge: "start" | "end"
  /**
   * The scroll range when it started toward that edge: it never scrolls past it, so content that grows
   * while it scrolls doesn't keep it scrolling.
   */
  readonly limit: number
}

/**
 * One update on one axis: how far to scroll, negative toward the start, and the state for the next.
 * `pointer`, `start` and `end` are in the viewport's px: the pointer, and the scroller's visible edges,
 * held within the viewport. Within `THRESHOLD` of an edge it scrolls `MAX_SPEED` × (1 − distance ÷
 * `THRESHOLD`)² toward it.
 * - **It starts** only while the pointer moves toward that edge (`velocity`), and reads `maxScroll()`
 *   then, the only time it's read.
 * - **It keeps on** while the pointer stays near the edge, and stops at the end at the range it read.
 *   `scroll` is how far the scroller is scrolled.
 * - **Away from both edges** there's no state.
 */
// Motion's algorithm, as a pure step:
// https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts
export const step = (
  state: Option.Option<State>,
  input: {
    readonly pointer: number
    readonly start: number
    readonly end: number
    readonly velocity: number
    readonly scroll: number
    readonly maxScroll: () => number
  },
): { readonly amount: number; readonly state: Option.Option<State> } => {
  /** A step that scrolls `amount` toward `next`'s edge, stopping at its limit. */
  const scrollWithin = (next: State, amount: number) =>
    Bool.match(Bool.and(amount > 0, input.scroll >= next.limit), {
      onTrue: () => ({ amount: 0, state: Option.some(next) }),
      onFalse: () => ({ amount, state: Option.some(next) }),
    })
  return Option.match(nearEdge(input.pointer - input.start, input.end - input.pointer), {
    onNone: () => ({ amount: 0, state: Option.none() }),
    onSome: ([edge, amount]) =>
      Option.match(Option.filter(state, (current) => current.edge === edge), {
        onSome: (current) => scrollWithin(current, amount),
        // A start at an edge, or a switch to the other one, needs motion toward it; the limit
        // is read once, at the start.
        onNone: () =>
          Bool.match(movingToward(edge, input.velocity), {
            onTrue: () => scrollWithin({ edge, limit: input.maxScroll() }, amount),
            onFalse: () => ({ amount: 0, state }),
          }),
      }),
  })
}

/** Scroll toward an edge within the threshold: faster the nearer, as the square of the closeness. */
const toward = (distance: number): number => {
  const intensity = 1 - distance / THRESHOLD
  return MAX_SPEED * intensity * intensity
}

/** The edge the pointer is within {@link THRESHOLD} of, the start first, and the scroll toward it. */
const nearEdge = (fromStart: number, fromEnd: number): Option.Option<readonly ["start" | "end", number]> =>
  Option.map(Option.liftPredicate(fromStart, isNear), (d) => ["start", -toward(d)] as const).pipe(
    Option.orElse(() => Option.map(Option.liftPredicate(fromEnd, isNear), (d) => ["end", toward(d)] as const)),
  )

/** Nearer an edge than {@link THRESHOLD}. */
const isNear = (distance: number): boolean => distance < THRESHOLD

/** A pointer moving toward `edge`. */
const movingToward = (edge: "start" | "end", velocity: number): boolean =>
  Match.value(edge).pipe(
    Match.when("start", () => velocity < 0),
    Match.when("end", () => velocity > 0),
    Match.exhaustive,
  )

/**
 * The axis Auto-scroll follows: a one-axis group's own, and in a grid the one the pointer moves faster
 * on, `y` on a tie, as Motion's.
 */
// Motion's `>` (Reorder/Item.tsx @ 16c6122).
export const axis = (axis: Reorder.Axis, velocity: Point.Point): "x" | "y" =>
  Match.value(axis).pipe(
    Match.when("xy", () =>
      Bool.match(Math.abs(velocity.x) > Math.abs(velocity.y), { onTrue: (): "x" | "y" => "x", onFalse: (): "x" | "y" => "y" }),
    ),
    Match.orElse((single) => single),
  )
