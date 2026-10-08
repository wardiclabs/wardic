import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { Point } from "../math/index.ts"
import type { ReorderAxis } from "./types.ts"

/**
 * How near (px) the pointer must be to a scroller's visible edge for **Auto-scroll**.
 * Motion's `threshold` (Reorder/utils/auto-scroll.ts:1 at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const AUTO_SCROLL_THRESHOLD = 50

/**
 * The most **Auto-scroll** moves a scroller per update (px), at its edge. Motion's
 * `maxSpeed` (Reorder/utils/auto-scroll.ts:2 at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const AUTO_SCROLL_MAX_SPEED = 25

/**
 * The edge **Auto-scroll** is scrolling toward, and the scroll range it had when that
 * edge activated (it never scrolls past it, so content that grows while scrolling
 * doesn't scroll forever).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface AutoScrollState {
  readonly edge: "start" | "end"
  readonly limit: number
}

/**
 * One update of **Auto-scroll** on one axis: how far to scroll the scroller, and the
 * state for the next update. Motion's algorithm (Reorder/utils/auto-scroll.ts at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts),
 * as a pure step.
 *
 * `pointer`, `start` and `end` are viewport px: the scroller's visible edges on the
 * axis, clamped to the viewport by the caller. Within {@link AUTO_SCROLL_THRESHOLD} of
 * an edge it scrolls {@link AUTO_SCROLL_MAX_SPEED} x (1 - distance / threshold)^2
 * toward it (negative toward the start). An edge starts only while the pointer moves
 * toward it (`velocity` on the axis), and records `maxScroll()` then (the only time
 * it's read); once active it keeps scrolling while the pointer stays in the zone, and
 * stops toward the end at that recorded range (`scroll` is the scroller's offset).
 * Outside both zones there is no state.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const autoScrollStep = (
  state: Option.Option<AutoScrollState>,
  input: {
    readonly pointer: number
    readonly start: number
    readonly end: number
    readonly velocity: number
    readonly scroll: number
    readonly maxScroll: () => number
  },
): { readonly amount: number; readonly state: Option.Option<AutoScrollState> } => {
  /** A step that scrolls `amount` toward `next`'s edge, stopping at its limit. */
  const scrollWithin = (next: AutoScrollState, amount: number) =>
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
  const intensity = 1 - distance / AUTO_SCROLL_THRESHOLD
  return AUTO_SCROLL_MAX_SPEED * intensity * intensity
}

/** The edge the pointer is within {@link AUTO_SCROLL_THRESHOLD} of, the start first, and the scroll toward it. */
const nearEdge = (fromStart: number, fromEnd: number): Option.Option<readonly ["start" | "end", number]> =>
  Option.map(Option.liftPredicate(fromStart, isNear), (d) => ["start", -toward(d)] as const).pipe(
    Option.orElse(() => Option.map(Option.liftPredicate(fromEnd, isNear), (d) => ["end", toward(d)] as const)),
  )

/** Nearer an edge than {@link AUTO_SCROLL_THRESHOLD}. */
const isNear = (distance: number): boolean => distance < AUTO_SCROLL_THRESHOLD

/** A pointer moving toward `edge`. */
const movingToward = (edge: "start" | "end", velocity: number): boolean =>
  Match.value(edge).pipe(
    Match.when("start", () => velocity < 0),
    Match.when("end", () => velocity > 0),
    Match.exhaustive,
  )

/**
 * The axis **Auto-scroll** follows: a single-axis group's own, and in a grid the axis
 * the pointer moves faster on (`y` on a tie, as Motion's `>` gives: Reorder/Item.tsx
 * at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const autoScrollAxis = (axis: ReorderAxis, velocity: Point): "x" | "y" =>
  Match.value(axis).pipe(
    Match.when("xy", () =>
      Bool.match(Math.abs(velocity.x) > Math.abs(velocity.y), { onTrue: (): "x" | "y" => "x", onFalse: (): "x" | "y" => "y" }),
    ),
    Match.orElse((single) => single),
  )
