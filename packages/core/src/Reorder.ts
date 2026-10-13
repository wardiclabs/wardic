/**
 * The `Reorder` module: the **Reorder group**'s pure pieces (ADR-0020): the Crossover
 * (`check`), axis detection, and the group a binding drives from a drag, a `Pipeable` data type
 * (`Group`) with `dual` operations (ADR-0028, decision 1). DOM-free; the binding and the
 * Environment supply the boxes, points and scrollers.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import { constVoid, dual, identity } from "effect/Function"
import * as Inspectable from "effect/Inspectable"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Num from "effect/Number"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type { Invariant } from "effect/Types"
import type * as Box from "./Box.ts"
import type * as Point from "./Point.ts"

/**
 * The axis a **Reorder group** reorders on: a column (`"y"`), a row (`"x"`), or a
 * wrapped grid (`"xy"`). Motion's `Axis` (Reorder/types.ts at 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export type Axis = "x" | "y" | "xy"

/**
 * One reorderable item as the **Crossover** sees it: its value and its layout box (the
 * slot, not where it paints while dragged). Motion's `ItemData` (Reorder/types.ts at
 * 16c6122).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface ItemData<V> {
  readonly value: V
  readonly layout: Box.Box
}

const centreOf = (axis: Box.Axis): number => axis.min + (axis.max - axis.min) * 0.5

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
const indexOf = <V>(order: ReadonlyArray<ItemData<V>>, value: V): Option.Option<number> =>
  Arr.findFirstIndex(order, (item) => item.value === value)

/**
 * The **Crossover**: the order after the item holding `value` has been dragged
 * `offset` from its slot, moving at `velocity`. Returns the same `order` reference
 * when nothing moves, so a caller can compare by reference (Motion's Group.tsx does).
 *
 * - `"xy"` (a wrapped grid) is Motion's `check` (Reorder/utils/check-reorder.ts
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
export const check = <V>(
  order: ReadonlyArray<ItemData<V>>,
  value: V,
  offset: Point.Point,
  velocity: Point.Point,
  axis: Axis,
  direction: "ltr" | "rtl" = "ltr",
): ReadonlyArray<ItemData<V>> =>
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
  order: ReadonlyArray<ItemData<V>>,
  index: number,
  offset: Point.Point,
  velocity: Point.Point,
  axis: "x" | "y",
): ReadonlyArray<ItemData<V>> =>
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
  order: ReadonlyArray<ItemData<V>>,
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
  readonly items: Arr.NonEmptyReadonlyArray<ItemData<V>>
  readonly min: number
  readonly max: number
}

/** Motion's `"xy"` branch (check-reorder.ts:17-51 at 16c6122). */
const checkReorderXY = <V>(
  order: ReadonlyArray<ItemData<V>>,
  index: number,
  offset: Point.Point,
  direction: "ltr" | "rtl",
): ReadonlyArray<ItemData<V>> => {
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
const getLines = <V>(order: ReadonlyArray<ItemData<V>>): Arr.NonEmptyReadonlyArray<Line<V>> =>
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
const lineOf = <V>(item: ItemData<V>): Line<V> => ({ items: [item], min: item.layout.y.min, max: item.layout.y.max })

const distanceToLine = <V>(y: number, line: Line<V>): number =>
  Match.value(y).pipe(
    Match.when((v: number) => v < line.min, (v) => line.min - v),
    Match.when((v: number) => v > line.max, (v) => v - line.max),
    Match.orElse(() => 0),
  )

/** Insert the item into `line` before the first item past `x` in `direction` (check-reorder.ts:102-122). */
const moveToLine = <V>(
  order: ReadonlyArray<ItemData<V>>,
  index: number,
  x: number,
  line: Line<V>,
  direction: "ltr" | "rtl",
): ReadonlyArray<ItemData<V>> => {
  const remaining = Arr.remove(order, index)
  /** An item's index in `remaining`, or -1 for none (`indexOf`'s answer, which `splice` reads from the end). */
  const remainingIndexOf = (item: ItemData<V>): number =>
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
const distanceToBox = (point: Point.Point, box: Box.Box): number => {
  const x = Math.max(box.x.min - point.x, 0, point.x - box.x.max)
  const y = Math.max(box.y.min - point.y, 0, point.y - box.y.max)
  return x * x + y * y
}

const isSeparated = (a: Box.Axis, b: Box.Axis): boolean => Bool.or(a.max <= b.min, b.max <= a.min)

/**
 * The axis a set of item boxes is laid out on: `"x"` if some pair doesn't overlap
 * horizontally, `"y"` if some pair doesn't overlap vertically, `"xy"` if both (a
 * wrapped grid), and `"y"` otherwise. It compares pairs and stops once both are
 * found. Motion's `detectAxis` (Reorder/utils/detect-axis.ts at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/detect-axis.ts),
 * ported.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const detectAxis = (layouts: ReadonlyArray<Box.Box>): Axis => {
  // Every unordered pair of boxes.
  const pairs = Arr.flatMap(layouts, (a, i) => Arr.map(Arr.drop(layouts, i + 1), (b) => [a, b] as const))
  const x = Arr.some(pairs, ([a, b]) => isSeparated(a.x, b.x))
  const y = Arr.some(pairs, ([a, b]) => isSeparated(a.y, b.y))
  return Match.value({ x, y }).pipe(
    Match.when({ x: true, y: true }, (): Axis => "xy"),
    Match.when({ x: true }, (): Axis => "x"),
    Match.orElse((): Axis => "y"),
  )
}

// --- The group ----------------------------------------------------------------

const TypeId = "~@wardic/core/Reorder"

/**
 * What a **Reorder group** reads from one item: its layout box (the slot, `None`
 * before it's measured), how far it's dragged from that slot, and a count that rises
 * each time a Measure pass reads its box. A projection node's handle provides all
 * three (ADR-0016, *Amendment (Reorder)*); the group pulls them, it isn't pushed to.
 *
 * Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and Environment authors.
 */
export interface ItemSource {
  readonly layoutBox: () => Option.Option<Box.Box>
  readonly dragOffset: () => Point.Point
  readonly layoutVersion: () => number
}

/**
 * A **Reorder group**'s inputs. `values` is the app's order, read when it's needed;
 * `onReorder` receives each new order (the app sets it, as with Motion's). `axis`
 * overrides the detected axis when it gives one (`Some`), read at each drag start; `direction` is the group's
 * inline direction (`"ltr"` when absent), read at each drag start. `debug` receives the
 * cold-path events: `reorder` { value, from, to, axis, direction } once per reorder,
 * `reorder waits` { value } once per wait for a Measure pass, `reorder start`
 * { value, axis, direction } and `move` { value, from, to }.
 *
 * Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and Environment authors.
 */
export interface GroupOptions<V> {
  readonly values: () => ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: (() => Option.Option<Axis>) | undefined
  readonly direction?: (() => "ltr" | "rtl") | undefined
  readonly debug?: ((event: string, annotations: Record<string, unknown>) => void) | undefined
}

/** The one drag gesture a group runs at a time. */
interface Gesture<V> {
  readonly value: V
  readonly axis: Axis
  readonly direction: "ltr" | "rtl"
  /** The dragged item's `layoutVersion()` at the last reorder, until a Measure pass passes it. */
  guard: Option.Option<number>
  /** Whether this guard's wait has been logged. */
  waited: boolean
}

/**
 * A **Reorder group** (ADR-0020): the items registered by value, and one drag gesture at a time.
 * A `Pipeable` data type (ADR-0028, decision 1), built by {@link make}; its operations take it
 * first and are `dual`:
 *
 * - `register(group, value, source)` adds an item (a value has one source; the returned
 *   function removes it). An unregistered value stays in `values` at its index.
 * - `resolveAxis(group)` is the override, else {@link detectAxis} over the measured items'
 *   boxes in `values` order.
 * - `dragStart` fixes the gesture's axis and direction and returns the axis;
 *   `dragMove` runs the **Crossover** for the dragged item with the drag sample's velocity
 *   (the pointer's over its last 100 ms, ADR-0004 *Amendment (#139)*) and returns it, for
 *   Auto-scroll; `dragEnd` ends it.
 * - `move(group, value, toIndex)` moves a value in code (clamped to the list, an unknown
 *   value ignored).
 *
 * Its state is the group's own, changed only by those operations.
 *
 * Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and Environment authors.
 */
export interface Group<in out V> extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: { readonly _V: Invariant<V> }
  /** The inputs `make` took. */
  readonly options: GroupOptions<V>
  /** Each registered item's source, by value. */
  readonly sources: Map<V, ItemSource>
  /** The drag gesture, while one runs. */
  readonly gesture: MutableRef.MutableRef<Option.Option<Gesture<V>>>
}

const Proto = {
  [TypeId]: { _V: identity },
  ...Inspectable.BaseProto,
  toJSON(this: Group<unknown>) {
    return {
      _id: "Reorder.Group",
      registered: this.sources.size,
      dragging: Option.map(MutableRef.get(this.gesture), (gesture) => gesture.value),
    }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * Build a **Reorder group** (ADR-0020). Each drag sample reads the measured items'
 * boxes and the dragged item's offset from their sources, runs the **Crossover**
 * (Motion's `check`, with the single-axis neighbour chosen by position), and on
 * a new order maps it back onto `values`, keeping unmeasured values at their indexes
 * (Motion's Group.tsx:160-166 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), then calls
 * `onReorder`. After a reorder it waits until the dragged item's `layoutVersion()`
 * rises, so a sample read against the boxes from before the reorder can't swap it
 * back; Motion waits for React's next commit (its guard is set at Group.tsx:158 and
 * cleared by an effect at :172-174). The registry is a plain `Map` keyed by value.
 *
 * Per sample it allocates nothing but a new order on a reorder.
 */
export const make = <V>(options: GroupOptions<V>): Group<V> =>
  Object.assign(Object.create(Proto), {
    options,
    sources: new Map<V, ItemSource>(),
    gesture: MutableRef.make(Option.none<Gesture<V>>()),
  })

/** Whether `u` is a **Reorder group** (built by {@link make}). */
export const isGroup = (u: unknown): u is Group<unknown> => Predicate.hasProperty(u, TypeId)

const ZERO: Point.Point = { x: 0, y: 0 }

/** A measured item, with its index in `values`. */
interface Measured<V> extends ItemData<V> {
  readonly index: number
}

/** A cold-path event, to the group's `debug`. */
const log = <V>(group: Group<V>, event: string, annotations: Record<string, unknown>): void => {
  if (Predicate.isNotUndefined(group.options.debug)) group.options.debug(event, annotations)
}

/** An item's box, while it is registered and has one. */
const layoutOf = <V>(group: Group<V>, value: V): Option.Option<Box.Box> =>
  Option.flatMap(Option.fromUndefinedOr(group.sources.get(value)), (source) => source.layoutBox())

/** The measured order: each value with a box, and its index in `values`. */
const measure = <V>(group: Group<V>, values: ReadonlyArray<V>): ReadonlyArray<Measured<V>> =>
  Arr.getSomes(Arr.map(values, (value, index) => Option.map(layoutOf(group, value), (layout) => ({ value, layout, index }))))

/**
 * After a reorder, the drag waits until a Measure pass has measured the new order: true while
 * it waits (logged once), false once the item's layout has moved past the guard.
 */
const waiting = <V>(group: Group<V>, g: Gesture<V>, value: V, source: ItemSource): boolean =>
  Option.match(g.guard, {
    onNone: () => false,
    onSome: (guard) =>
      Bool.match(source.layoutVersion() <= guard, {
        onTrue: () => {
          if (!g.waited) {
            g.waited = true
            log(group, "reorder waits", { value })
          }
          return true
        },
        onFalse: () => {
          g.guard = Option.none()
          g.waited = false
          return false
        },
      }),
  })

/** One drag sample's check for a Crossover, and the reorder it makes. */
const reorderOn = <V>(group: Group<V>, g: Gesture<V>, value: V, source: ItemSource, velocity: Point.Point): void => {
  if (waiting(group, g, value, source)) return
  const values = group.options.values()
  const measured = measure(group, values)
  const next = check(measured, value, source.dragOffset(), velocity, g.axis, g.direction)
  if (next === measured) return
  // The measured items' slots in `values`, refilled in their new order.
  const newValues = Arr.reduce(next, Arr.copy(values), (out, item, i) => {
    out[Arr.getUnsafe(measured, i).index] = item.value
    return out
  })
  const indexIn = (list: ReadonlyArray<V>): number =>
    Option.getOrElse(Arr.findFirstIndex(list, (v) => v === value), () => -1)
  g.guard = Option.some(source.layoutVersion())
  g.waited = false
  log(group, "reorder", { value, from: indexIn(values), to: indexIn(newValues), axis: g.axis, direction: g.direction })
  group.options.onReorder(newValues)
}

/** Add `value`'s item, read through `source`; the returned function removes it. */
export const register: {
  <V>(value: V, source: ItemSource): (group: Group<V>) => () => void
  <V>(group: Group<V>, value: V, source: ItemSource): () => void
} = dual(3, <V>(group: Group<V>, value: V, source: ItemSource): (() => void) => {
  group.sources.set(value, source)
  return () => {
    if (group.sources.get(value) === source) group.sources.delete(value)
  }
})

/** The group's axis: its override, else {@link detectAxis} over the measured items' boxes. */
export const resolveAxis = <V>(group: Group<V>): Axis =>
  Option.fromUndefinedOr(group.options.axis).pipe(
    Option.flatMap((axis) => axis()),
    Option.getOrElse(() => detectAxis(Arr.map(measure(group, group.options.values()), (item) => item.layout))),
  )

/** Start dragging `value`'s item: the gesture's axis and direction are fixed now. Returns the axis. */
export const dragStart: {
  <V>(value: V): (group: Group<V>) => Axis
  <V>(group: Group<V>, value: V): Axis
} = dual(2, <V>(group: Group<V>, value: V): Axis => {
  const axis = resolveAxis(group)
  const direction = Option.fromUndefinedOr(group.options.direction).pipe(
    Option.flatMap((directionOf) => Option.fromNullishOr(directionOf())),
    Option.getOrElse((): "ltr" | "rtl" => "ltr"),
  )
  MutableRef.set(group.gesture, Option.some({ value, axis, direction, guard: Option.none(), waited: false }))
  log(group, "reorder start", { value, axis, direction })
  return axis
})

/**
 * A drag sample of `value`'s item, moving at `velocity` (the sample's: the pointer's over its
 * last 100 ms): runs the **Crossover**, and returns `velocity` (no motion when `value` isn't
 * the one dragged).
 */
export const dragMove: {
  <V>(value: V, velocity: Point.Point): (group: Group<V>) => Point.Point
  <V>(group: Group<V>, value: V, velocity: Point.Point): Point.Point
} = dual(3, <V>(group: Group<V>, value: V, velocity: Point.Point): Point.Point =>
  Option.match(Option.filter(MutableRef.get(group.gesture), (g) => g.value === value), {
    onNone: () => ZERO,
    onSome: (g) => {
      Option.match(Option.fromUndefinedOr(group.sources.get(value)), {
        onNone: constVoid,
        onSome: (source) => reorderOn(group, g, value, source, velocity),
      })
      return velocity
    },
  }))

/** End the drag of `value`'s item (nothing, when it isn't the one dragged). */
export const dragEnd: {
  <V>(value: V): (group: Group<V>) => void
  <V>(group: Group<V>, value: V): void
} = dual(2, <V>(group: Group<V>, value: V): void => {
  if (Option.exists(MutableRef.get(group.gesture), (g) => g.value === value)) {
    MutableRef.set(group.gesture, Option.none())
  }
})

/** Move `value` to `toIndex` in code, through `onReorder` (clamped to the list; an unknown value is ignored). */
export const move: {
  <V>(value: V, toIndex: number): (group: Group<V>) => void
  <V>(group: Group<V>, value: V, toIndex: number): void
} = dual(3, <V>(group: Group<V>, value: V, toIndex: number): void => {
  const values = group.options.values()
  Option.match(Arr.findFirstIndex(values, (v) => v === value), {
    onNone: constVoid,
    onSome: (from) => {
      const to = Math.min(Math.max(0, toIndex), values.length - 1)
      if (to === from) return
      log(group, "move", { value, from, to })
      group.options.onReorder(moveItem(values, from, to))
    },
  })
})
