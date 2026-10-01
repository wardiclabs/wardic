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
  const next = [...arr]
  const startIndex = fromIndex < 0 ? next.length + fromIndex : fromIndex
  if (startIndex >= 0 && startIndex < next.length) {
    const endIndex = toIndex < 0 ? next.length + toIndex : toIndex
    const [item] = next.splice(fromIndex, 1)
    next.splice(endIndex, 0, item!)
  }
  return next
}

const indexOf = <V>(order: ReadonlyArray<ReorderItemData<V>>, value: V): number => {
  for (let i = 0; i < order.length; i++) if (order[i]!.value === value) return i
  return -1
}

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
): ReadonlyArray<ReorderItemData<V>> => {
  const index = indexOf(order, value)
  if (index === -1) return order
  if (axis === "xy") return checkReorderXY(order, index, offset, direction)

  const v = velocity[axis]
  if (!v) return order
  const own = order[index]!.layout[axis]
  const forward = v > 0
  const centre = centreOf(own)
  // The neighbour on the side the item moves toward: index - 1, else index + 1.
  let n = index - 1
  let nextCentre = centreOnSide(order, n, axis, centre, forward)
  if (Number.isNaN(nextCentre)) {
    n = index + 1
    nextCentre = centreOnSide(order, n, axis, centre, forward)
  }
  if (Number.isNaN(nextCentre)) return order
  const crossed = forward ? own.max + offset[axis] > nextCentre : own.min + offset[axis] < nextCentre
  return crossed ? moveItem(order, index, n) : order
}

/** `order[n]`'s centre on `axis` if it lies past `centre` in the direction of motion, else NaN. */
const centreOnSide = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  n: number,
  axis: "x" | "y",
  centre: number,
  forward: boolean,
): number => {
  const next = order[n]
  if (next === undefined) return Number.NaN
  const c = centreOf(next.layout[axis])
  return (forward ? c > centre : c < centre) ? c : Number.NaN
}

interface Line<V> {
  readonly items: Array<ReorderItemData<V>>
  min: number
  max: number
}

/** Motion's `"xy"` branch (check-reorder.ts:17-51 at 16c6122). */
const checkReorderXY = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  index: number,
  offset: Point,
  direction: "ltr" | "rtl",
): ReadonlyArray<ReorderItemData<V>> => {
  const item = order[index]!
  const { layout } = item
  const center = { x: centreOf(layout.x) + offset.x, y: centreOf(layout.y) + offset.y }
  const lines = getLines(order)
  const sourceLine = lines.find((line) => line.items.includes(item))!
  const targetLine = lines.reduce((closest, line) =>
    distanceToLine(center.y, line) < distanceToLine(center.y, closest) ? line : closest,
  )
  if (targetLine !== sourceLine) return moveToLine(order, index, center.x, targetLine, direction)

  let target = -1
  let targetDistance = distanceToBox(center, layout)
  order.forEach((other, targetIndex) => {
    if (targetIndex === index) return
    const distance = distanceToBox(center, other.layout)
    if (distance < targetDistance) {
      target = targetIndex
      targetDistance = distance
    }
  })
  return target === -1 ? order : moveItem(order, index, index + Math.sign(target - index))
}

/** Items grouped into lines of overlapping y ranges, in order (check-reorder.ts:77-96). */
const getLines = <V>(order: ReadonlyArray<ReorderItemData<V>>): Array<Line<V>> => {
  const lines: Array<Line<V>> = []
  for (const item of order) {
    const { min, max } = item.layout.y
    const line = lines[lines.length - 1]
    if (line === undefined || min >= line.max || max <= line.min) {
      lines.push({ items: [item], min, max })
    } else {
      line.items.push(item)
      line.min = Math.min(line.min, min)
      line.max = Math.max(line.max, max)
    }
  }
  return lines
}

const distanceToLine = <V>(y: number, line: Line<V>): number =>
  y < line.min ? line.min - y : y > line.max ? y - line.max : 0

/** Insert the item into `line` before the first item past `x` in `direction` (check-reorder.ts:102-122). */
const moveToLine = <V>(
  order: ReadonlyArray<ReorderItemData<V>>,
  index: number,
  x: number,
  line: Line<V>,
  direction: "ltr" | "rtl",
): ReadonlyArray<ReorderItemData<V>> => {
  const remaining = order.filter((_, itemIndex) => itemIndex !== index)
  const before = line.items.find((item) => {
    const center = centreOf(item.layout.x)
    return direction === "ltr" ? x < center : x > center
  })
  const targetIndex = before !== undefined ? remaining.indexOf(before) : remaining.indexOf(line.items[line.items.length - 1]!) + 1
  const nextOrder = [...remaining]
  nextOrder.splice(targetIndex, 0, order[index]!)
  return nextOrder.every((item, itemIndex) => item === order[itemIndex]) ? order : nextOrder
}

/** The squared distance from `point` to `box` (0 inside it) (check-reorder.ts:124-133). */
const distanceToBox = (point: Point, box: Box): number => {
  const x = Math.max(box.x.min - point.x, 0, point.x - box.x.max)
  const y = Math.max(box.y.min - point.y, 0, point.y - box.y.max)
  return x * x + y * y
}
