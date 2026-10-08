import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import * as Match from "effect/Match"
import * as Num from "effect/Number"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import type { Axis, Box } from "../layout/box.ts"
import type { Point } from "../math/index.ts"
import type { ReorderAxis, ReorderItemData } from "./types.ts"

const centreOf = (axis: Axis): number => axis.min + (axis.max - axis.min) * 0.5

/**
 * `arr` with the item at `fromIndex` moved to `toIndex`, as a new array (negative
 * indexes count from the end). motion-utils' `moveItem` (array.ts:11-22 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8), ported.
 *
 * @internal
 */
export const moveItem = <T>(arr: ReadonlyArray<T>, fromIndex: number, toIndex: number): Array<T> => {
  const next = Arr.copy(arr)
  const startIndex = fromEnd(fromIndex, next.length)
  if (Bool.and(startIndex >= 0, startIndex < next.length)) {
    const endIndex = fromEnd(toIndex, next.length)
    const removed = next.splice(fromIndex, 1)
    next.splice(endIndex, 0, Arr.getUnsafe(removed, 0))
  }
  return next
}

/** An index counted from the end when negative, as `splice` reads it. */
const fromEnd = (index: number, length: number): number =>
  Bool.match(index < 0, { onTrue: () => length + index, onFalse: () => index })

/** `value`'s index in `order`. */
const indexOf = <V>(order: ReadonlyArray<ReorderItemData<V>>, value: V): Option.Option<number> =>
  Arr.findFirstIndex(order, (item) => item.value === value)

/**
 * The **Crossover**: the order after the item holding `value` has been dragged
 * `offset` from its slot, moving at `velocity`. Returns the same `order` reference
 * when nothing moves, so a caller can compare by reference (Motion's Group.tsx does).
 *
 * - `"xy"` (a wrapped grid) is Motion's `checkReorder` (Reorder/utils/check-reorder.ts
 *   at 16c61222c4166bbef5ff6ab0051192faa79fa8c8, https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/check-reorder.ts):
 *   the dragged centre picks the nearest line (a row of overlapping boxes); on another
 *   line it's inserted before the first item whose centre is past it in `direction`,
 *   and on its own line it steps one place toward the nearest box.
 * - A single axis moves one place at most. The item moves toward the neighbour, of
 *   the two next to it in `order`, whose centre lies on the side it's moving to (a
 *   greater centre for a positive velocity on the axis, a smaller one for a negative),
 *   once its edge facing that neighbour crosses the neighbour's centre. No velocity on
 *   the axis moves nothing.
 *
 * The single-axis neighbour is chosen by position where Motion's is chosen by index
 * (`index + sign(velocity)`, since framer-motion 13.1): with the first value laid out
 * last (`direction: rtl`, `row-reverse`, `column-reverse`), Motion's never reorders
 * toward a neighbour and walks the item to the far end in 30 px away from one (motion/react
 * 13.4.6, every run in Chromium and Firefox: .tmp/reorder/runs-*-{rtl,reverse}.json;
 * framer-motion 13.0 sorted by position). In normal flow the two rules pick the same
 * neighbour.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const checkReorder = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  value: V,
  offset: Point,
  velocity: Point,
  axis: ReorderAxis,
  direction: "ltr" | "rtl" = "ltr",
): ReadonlyArray<ReorderItemData<V>> =>
  Option.match(indexOf(order, value), {
    onNone: () => order,
    onSome: (index) =>
      Match.value(axis).pipe(
        Match.when("xy", () => checkReorderXY(order, index, offset, direction)),
        Match.orElse((single) => checkReorderOnAxis(order, index, offset, velocity, single)),
      ),
  })

/** The single-axis rule: past the centre of the neighbour on the side the item moves toward. */
const checkReorderOnAxis = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  index: number,
  offset: Point,
  velocity: Point,
  axis: "x" | "y",
): ReadonlyArray<ReorderItemData<V>> =>
  Option.match(Option.liftPredicate(velocity[axis], Predicate.isTruthy), {
    // No motion on the axis (0, or NaN): no direction, so no reorder.
    onNone: () => order,
    onSome: (v) => {
      const own = Arr.getUnsafe(order, index).layout[axis]
      const forward = v > 0
      const centre = centreOf(own)
      const neighbour = (n: number) =>
        Option.map(centreOnSide(order, n, axis, centre, forward), (nextCentre) => [n, nextCentre] as const)
      // The neighbour on the side the item moves toward: index - 1, else index + 1.
      return Option.match(Option.orElse(neighbour(index - 1), () => neighbour(index + 1)), {
        onNone: () => order,
        onSome: ([n, nextCentre]) => {
          const crossed = Bool.match(forward, {
            onTrue: () => own.max + offset[axis] > nextCentre,
            onFalse: () => own.min + offset[axis] < nextCentre,
          })
          return Bool.match(crossed, { onTrue: () => moveItem(order, index, n), onFalse: () => order })
        },
      })
    },
  })

/** `order[n]`'s centre on `axis` if it lies past `centre` in the direction of motion, else NaN. */
const centreOnSide = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  n: number,
  axis: "x" | "y",
  centre: number,
  forward: boolean,
): Option.Option<number> =>
  Arr.get(order, n).pipe(
    Option.map((next) => centreOf(next.layout[axis])),
    Option.filter((c) => Bool.match(forward, { onTrue: () => c > centre, onFalse: () => c < centre })),
  )

interface Line<V> {
  readonly items: Arr.NonEmptyReadonlyArray<ReorderItemData<V>>
  readonly min: number
  readonly max: number
}

/** Motion's `"xy"` branch (check-reorder.ts:17-51 at 16c6122). */
const checkReorderXY = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  index: number,
  offset: Point,
  direction: "ltr" | "rtl",
): ReadonlyArray<ReorderItemData<V>> => {
  const item = Arr.getUnsafe(order, index)
  const { layout } = item
  const center = { x: centreOf(layout.x) + offset.x, y: centreOf(layout.y) + offset.y }
  const lines = getLines(order)
  const sourceLine = Option.getOrThrow(Arr.findFirst(lines, (line) => line.items.includes(item)))
  // The nearest line, the earlier on a tie.
  const targetLine = Arr.min(lines, Order.mapInput(Num.Order, (line: Line<V>) => distanceToLine(center.y, line)))
  if (targetLine !== sourceLine) return moveToLine(order, index, center.x, targetLine, direction)

  // The nearest other item nearer than the item's own box, the earlier on a tie.
  const [target] = Arr.reduce(
    order,
    [Option.none<number>(), distanceToBox(center, layout)] as const,
    ([best, bestDistance], other, targetIndex) => {
      const distance = distanceToBox(center, other.layout)
      return Bool.match(Bool.and(targetIndex !== index, distance < bestDistance), {
        onTrue: () => [Option.some(targetIndex), distance] as const,
        onFalse: () => [best, bestDistance] as const,
      })
    },
  )
  return Option.match(target, {
    onNone: () => order,
    onSome: (t) => moveItem(order, index, index + Math.sign(t - index)),
  })
}

/** Items grouped into lines of overlapping y ranges, in order (check-reorder.ts:77-96). */
const getLines = <V>(order: ReadonlyArray<ReorderItemData<V>>): Arr.NonEmptyReadonlyArray<Line<V>> =>
  // `order` holds the dragged item, so it has a first entry.
  Arr.reduce(Arr.drop(order, 1), Arr.of(lineOf(Arr.getUnsafe(order, 0))), (lines, item) => {
    const { min, max } = item.layout.y
    const line = Arr.lastNonEmpty(lines)
    return Bool.match(Bool.or(min >= line.max, max <= line.min), {
      // Clear of the line above or below it: a new line.
      onTrue: () => Arr.append(lines, lineOf(item)),
      // Overlapping the current line: it joins it, and the line grows to cover it.
      onFalse: () =>
        Arr.append(Arr.initNonEmpty(lines), {
          items: Arr.append(line.items, item),
          min: Math.min(line.min, min),
          max: Math.max(line.max, max),
        }),
    })
  })

/** A line of one item. */
const lineOf = <V>(item: ReorderItemData<V>): Line<V> => ({ items: [item], min: item.layout.y.min, max: item.layout.y.max })

const distanceToLine = <V>(y: number, line: Line<V>): number =>
  Match.value(y).pipe(
    Match.when((v: number) => v < line.min, (v) => line.min - v),
    Match.when((v: number) => v > line.max, (v) => v - line.max),
    Match.orElse(() => 0),
  )

/** Insert the item into `line` before the first item past `x` in `direction` (check-reorder.ts:102-122). */
const moveToLine = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  index: number,
  x: number,
  line: Line<V>,
  direction: "ltr" | "rtl",
): ReadonlyArray<ReorderItemData<V>> => {
  const remaining = Arr.remove(order, index)
  /** An item's index in `remaining`, or -1 for none (`indexOf`'s answer, which `splice` reads from the end). */
  const remainingIndexOf = (item: ReorderItemData<V>): number =>
    Option.getOrElse(Arr.findFirstIndex(remaining, (other) => other === item), () => -1)
  const before = Arr.findFirst(line.items, (item) => {
    const center = centreOf(item.layout.x)
    return Bool.match(direction === "ltr", { onTrue: () => x < center, onFalse: () => x > center })
  })
  const targetIndex = Option.match(before, {
    onSome: remainingIndexOf,
    onNone: () => remainingIndexOf(Arr.lastNonEmpty(line.items)) + 1,
  })
  const nextOrder = Arr.copy(remaining)
  nextOrder.splice(targetIndex, 0, Arr.getUnsafe(order, index))
  return Bool.match(sameOrder(nextOrder, order), { onTrue: () => order, onFalse: () => nextOrder })
}

/** The same items in the same order. */
const sameOrder: <A>(self: ReadonlyArray<A>, that: ReadonlyArray<A>) => boolean = Arr.makeEquivalence(Equivalence.strictEqual())

/** The squared distance from `point` to `box` (0 inside it) (check-reorder.ts:124-133). */
const distanceToBox = (point: Point, box: Box): number => {
  const x = Math.max(box.x.min - point.x, 0, point.x - box.x.max)
  const y = Math.max(box.y.min - point.y, 0, point.y - box.y.max)
  return x * x + y * y
}
