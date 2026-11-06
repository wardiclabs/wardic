/**
 * Reorder groups: a list the user reorders by dragging an item, or with the keys, as Motion's
 * `Reorder.Group`. A `Group` holds its items by value and runs one drag at a time. A binding registers
 * each item with how to read its box, drives the group from a drag's samples (`dragStart`, `dragMove`,
 * `dragEnd`) or from keys (`lift`, `step`, `drop`, `cancel`), and the group calls `onReorder` with each
 * new order. `check` is the rule that decides when a dragged item swaps places, and
 * `defaultAnnouncements` what a screen reader hears. The binding and its Environment supply the boxes,
 * points, keys and scrollers.
 *
 * @example
 * import * as Reorder from "@wardic/core/Reorder"
 *
 * const group = Reorder.make({ values: () => items, onReorder: (next) => (items = next) })
 * const unregister = Reorder.register(group, item, source)
 * // As the item is dragged:
 * Reorder.dragStart(group, item)
 * Reorder.dragMove(group, item, sample.velocity)
 * Reorder.dragEnd(group, item)
 */
// ADR-0020: the **Reorder group**'s pure pieces: the **Crossover** (`check`), axis detection, and the
// group, driven from a drag or from the keys (a **Keyboard reorder**, ADR-0037), with its wording. A
// `Pipeable` data type (`Group`) with `dual` operations (ADR-0028, decision 1). DOM-free; the binding and
// the Environment speak the announcements.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import { constVoid, identity } from "effect/Function"
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
import type * as InputSource from "./InputSource.ts"
import type * as Point from "./Point.ts"
import { dual } from "./internal/dual.ts"

/** The axis a group reorders on: a column (`"y"`), a row (`"x"`), or a grid that wraps (`"xy"`), as Motion's `Axis`. */
// Motion's Reorder/types.ts @ 16c6122. Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
export type Axis = "x" | "y" | "xy"

/** An item as `check` sees it: its value and its layout box, its place in the list, not where it paints while it's dragged. */
// Motion's `ItemData` (Reorder/types.ts @ 16c6122). Tier 2 (ADR-0008).
export interface ItemData<V> {
  /** The item's value in the list. */
  readonly value: V
  /** Its layout box: its place in the list. */
  readonly layout: Box.Box
}

const centreOf = (axis: Box.Axis): number => axis.min + (axis.max - axis.min) * 0.5

/**
 * `arr` with the item at `fromIndex` moved to `toIndex`, as a new array; a negative index counts from
 * the end.
 *
 * @internal
 */
// motion-utils' `moveItem` (array.ts:11-22 @ 16c61222c4166bbef5ff6ab0051192faa79fa8c8), ported.
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
 * The order after the item holding `value` has been dragged `offset` from its place, moving at
 * `velocity`: the rule for when a dragged item swaps places. The same `order` when nothing moves, so a
 * caller can compare by reference.
 * - **One axis** moves the item one place at most: toward the neighbour, of the two next to it, whose
 *   centre lies the way it's moving, once its edge facing that neighbour crosses the neighbour's centre.
 *   No velocity on the axis moves nothing.
 * - **A grid** (`"xy"`), as Motion's: the dragged centre picks the nearest row. In another row, the item
 *   goes before the first item whose centre is past it in `direction`; in its own, it steps one place
 *   toward the nearest box.
 */
// The **Crossover**. Motion's Group.tsx compares by reference too. `"xy"` is Motion's `check`
// (Reorder/utils/check-reorder.ts @ 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
// https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/check-reorder.ts):
// a line is a row of overlapping boxes.
//
// The single-axis neighbour is chosen by position where Motion's is chosen by index (`index +
// sign(velocity)`, since framer-motion 13.1): with the first value laid out last (`direction: rtl`,
// `row-reverse`, `column-reverse`), Motion's never reorders toward a neighbour and walks the item to the
// far end in 30 px away from one (motion/react 13.4.6, every run in Chromium and Firefox:
// .tmp/reorder/runs-*-{rtl,reverse}.json; framer-motion 13.0 sorted by position). In normal flow the two
// rules pick the same neighbour. Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
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
 * The axis a list's item boxes are laid out on, as Motion's `detectAxis`: `"x"` if some two don't
 * overlap across, `"y"` if some two don't overlap down, `"xy"` if both, a grid that wraps, and `"y"`
 * otherwise. It stops once it has found both.
 */
// Motion's Reorder/utils/detect-axis.ts @ 16c61222c4166bbef5ff6ab0051192faa79fa8c8
// (https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/detect-axis.ts),
// ported. Tier 2 (ADR-0008).
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
 * What a group reads from one item, when it needs it: a layout projection's handle for the item gives
 * all three.
 */
// ADR-0016, *Amendment (Reorder)*: the group pulls them, it isn't pushed to. Tier 2 (ADR-0008, as amended
// by ADR-0025): Effect-native, for binding and Environment authors.
export interface ItemSource {
  /** Its layout box, its place in the list: `None` before it's measured. */
  readonly layoutBox: () => Option.Option<Box.Box>
  /** How far it's dragged from its place. */
  readonly dragOffset: () => Point.Point
  /** A count that rises each time its box is measured: after a reorder, a drag waits until it does. */
  // A Measure pass.
  readonly layoutVersion: () => number
}

/** A group's options: `make`'s. */
// Tier 2 (ADR-0008, as amended by ADR-0025).
export interface GroupOptions<V> {
  /** The app's order, read when it's needed. */
  readonly values: () => ReadonlyArray<V>
  /** Hears each new order, which the app sets, as with Motion's. */
  readonly onReorder: (values: Array<V>) => void
  /** The axis, when it's given (`Some`): read at each drag's start, over the one `detectAxis` finds. */
  readonly axis?: (() => Option.Option<Axis>) | undefined
  /** The group's inline direction, read at each drag's start: `"ltr"` when it's left out. */
  readonly direction?: (() => "ltr" | "rtl") | undefined
  /**
   * Hears what happens, for a debug log: `reorder` { value, from, to, axis, direction } once per reorder,
   * `reorder waits` { value } once per wait for the boxes to be measured, `reorder start` { value, axis,
   * direction }, and `move` { value, from, to }.
   */
  readonly debug?: ((event: string, annotations: Record<string, unknown>) => void) | undefined
}

/** A keyboard reorder under way: the lifted value, where it was, and the axis and direction fixed at the lift. */
// A **Keyboard reorder** (ADR-0037).
interface Lift<V> {
  /** The lifted item's value. */
  readonly value: V
  /** The order at the lift, which a cancel restores. */
  readonly origin: ReadonlyArray<V>
  /** The axis, fixed at the lift. */
  readonly axis: Axis
  /** The inline direction, fixed at the lift. */
  readonly direction: "ltr" | "rtl"
  /** The lifted item's `layoutVersion()` at its last step, until its box is measured again: a step waits while it's set. */
  // Until a Measure pass passes it, as a drag's guard.
  guard: Option.Option<number>
}

/** The drag a group runs, one at a time. */
interface Gesture<V> {
  /** The dragged item's value. */
  readonly value: V
  /** The axis, fixed at its start. */
  readonly axis: Axis
  /** The inline direction, fixed at its start. */
  readonly direction: "ltr" | "rtl"
  /** The dragged item's `layoutVersion()` at the last reorder, until its box is measured again: it doesn't reorder while it's set. */
  // Until a Measure pass passes it.
  guard: Option.Option<number>
  /** Whether this wait has been sent to `debug`. */
  waited: boolean
}

/**
 * A reorder group: its items by value, and one drag at a time. Made by `make`; its operations take it
 * first, or in a pipe.
 * - `register` adds an item: a value has one source, and the function it returns removes it. A value
 *   that isn't registered stays at its index in `values`.
 * - `resolveAxis` is the group's axis: the `axis` it's given, else `detectAxis` over its measured items.
 * - `dragStart` fixes a drag's axis and direction, and gives the axis; `dragMove` runs `check` for the
 *   dragged item, with the drag sample's velocity, and gives the velocity back for auto-scroll; `dragEnd`
 *   ends it.
 * - `move` moves a value in code, held to the list; a value it doesn't know is left out.
 * - `lift`, `step`, `drop` and `cancel` reorder one item with the keys, each giving where the item is,
 *   for its announcement.
 *
 * Its state is its own, changed only by those operations.
 */
// A **Reorder group** (ADR-0020): a `Pipeable` data type (ADR-0028, decision 1), its operations `dual`.
// `dragMove`'s velocity is the pointer's over its last 100 ms (ADR-0004 *Amendment (#139)*). A **Keyboard
// reorder** (ADR-0037). Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and
// Environment authors.
export interface Group<in out V> extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: { readonly _V: Invariant<V> }
  /** The inputs `make` took. */
  readonly options: GroupOptions<V>
  /** Each registered item's source, by value. */
  readonly sources: ReadonlyMap<V, ItemSource>
}

/**
 * A group as this module keeps it: its drag gesture while one runs, and its keyboard reorder while an
 * item is lifted (a **Keyboard reorder**, ADR-0037). Read from outside with {@link isDragging},
 * {@link isLifted} and {@link liftedValue}.
 */
// Hidden from the public type (#618, F1): a caller that set them would break the group's state.
interface State<V> extends Group<V> {
  readonly sources: Map<V, ItemSource>
  readonly gesture: MutableRef.MutableRef<Option.Option<Gesture<V>>>
  readonly lifted: MutableRef.MutableRef<Option.Option<Lift<V>>>
}

/** `group` as this module keeps it. */
const stateOf = <V>(group: Group<V>): State<V> => group as State<V>

const Proto = {
  [TypeId]: { _V: identity },
  ...Inspectable.BaseProto,
  toJSON(this: Group<unknown>) {
    return {
      _id: "Reorder.Group",
      registered: this.sources.size,
      dragging: Option.map(MutableRef.get(stateOf(this).gesture), (gesture) => gesture.value),
      lifted: Option.map(MutableRef.get(stateOf(this).lifted), (lift) => lift.value),
    }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * A reorder group over `options`' values. Each drag sample reads the measured items' boxes and the dragged
 * item's offset, runs `check`, and on a new order calls `onReorder` with it, a value with no box kept at
 * its index. After a reorder it waits until the dragged item's box is measured again, so a sample read
 * against the boxes from before can't swap it back.
 *
 * @example
 * const group = Reorder.make({ values: () => items, onReorder: (next) => (items = next) })
 */
// ADR-0020. A new order is mapped back onto `values`, keeping unmeasured values at their indexes (Motion's
// Group.tsx:160-166 @ 16c61222c4166bbef5ff6ab0051192faa79fa8c8). The wait is on `layoutVersion()`; Motion
// waits for React's next commit (its guard is set at Group.tsx:158 and cleared by an effect at :172-174).
// The registry is a plain `Map` keyed by value. Each sample builds the measured order (an entry per item
// with a box), and a new order on a reorder: about 17 µs a sample on 1,000 items in Chromium, 11–12 of
// them that build (#327).
export const make = <V>(options: GroupOptions<V>): Group<V> =>
  Object.assign(Object.create(Proto), {
    options,
    sources: new Map<V, ItemSource>(),
    gesture: MutableRef.make(Option.none<Gesture<V>>()),
    lifted: MutableRef.make(Option.none<Lift<V>>()),
  })

/** Whether `u` is a reorder group, made by `make`. */
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
  const newValues = refill(values, measured, next)
  const indexIn = (list: ReadonlyArray<V>): number =>
    Option.getOrElse(Arr.findFirstIndex(list, (v) => v === value), () => -1)
  g.guard = Option.some(source.layoutVersion())
  g.waited = false
  log(group, "reorder", { value, from: indexIn(values), to: indexIn(newValues), axis: g.axis, direction: g.direction })
  group.options.onReorder(newValues)
}

/** `values` with the measured items' slots refilled in `next`'s order: an unmeasured value keeps its index. */
const refill = <V>(values: ReadonlyArray<V>, measured: ReadonlyArray<Measured<V>>, next: ReadonlyArray<ItemData<V>>): Array<V> =>
  Arr.reduce(next, Arr.copy(values), (out, item, i) => {
    out[Arr.getUnsafe(measured, i).index] = item.value
    return out
  })

/** Adds `value`'s item, read through `source`. The function it returns removes it. */
export const register: {
  <V>(value: V, source: ItemSource): (group: Group<V>) => () => void
  <V>(group: Group<V>, value: V, source: ItemSource): () => void
} = dual(3, <V>(group: Group<V>, value: V, source: ItemSource): (() => void) => {
  stateOf(group).sources.set(value, source)
  return () => {
    if (group.sources.get(value) === source) stateOf(group).sources.delete(value)
  }
})

/** The group's axis: its `axis`, when it's given one, else `detectAxis` over the measured items' boxes. */
export const resolveAxis = <V>(group: Group<V>): Axis =>
  Option.fromUndefinedOr(group.options.axis).pipe(
    Option.flatMap((axis) => axis()),
    Option.getOrElse(() => detectAxis(Arr.map(measure(group, group.options.values()), (item) => item.layout))),
  )

/** The group's inline direction now: its `direction`, else `"ltr"`. */
const directionOf = <V>(group: Group<V>): "ltr" | "rtl" =>
  Option.fromUndefinedOr(group.options.direction).pipe(
    Option.flatMap((read) => Option.fromNullishOr(read())),
    Option.getOrElse((): "ltr" | "rtl" => "ltr"),
  )

/** Starts dragging `value`'s item: the drag's axis and direction are fixed now. Gives the axis. */
export const dragStart: {
  <V>(value: V): (group: Group<V>) => Axis
  <V>(group: Group<V>, value: V): Axis
} = dual(isGroup, <V>(group: Group<V>, value: V): Axis => {
  const axis = resolveAxis(group)
  const direction = directionOf(group)
  MutableRef.set(stateOf(group).gesture, Option.some({ value, axis, direction, guard: Option.none(), waited: false }))
  log(group, "reorder start", { value, axis, direction })
  return axis
})

/**
 * A drag sample of `value`'s item, moving at `velocity`, the sample's: runs `check`, and gives
 * `velocity` back, for auto-scroll; no motion when `value` isn't the one dragged.
 */
export const dragMove: {
  <V>(value: V, velocity: Point.Point): (group: Group<V>) => Point.Point
  <V>(group: Group<V>, value: V, velocity: Point.Point): Point.Point
} = dual(3, <V>(group: Group<V>, value: V, velocity: Point.Point): Point.Point =>
  Option.match(Option.filter(MutableRef.get(stateOf(group).gesture), (g) => g.value === value), {
    onNone: () => ZERO,
    onSome: (g) => {
      Option.match(Option.fromUndefinedOr(group.sources.get(value)), {
        onNone: constVoid,
        onSome: (source) => reorderOn(group, g, value, source, velocity),
      })
      return velocity
    },
  }))

/** Ends the drag of `value`'s item; nothing, when it isn't the one dragged. */
export const dragEnd: {
  <V>(value: V): (group: Group<V>) => void
  <V>(group: Group<V>, value: V): void
} = dual(isGroup, <V>(group: Group<V>, value: V): void => {
  if (Option.exists(MutableRef.get(stateOf(group).gesture), (g) => g.value === value)) {
    MutableRef.set(stateOf(group).gesture, Option.none())
  }
})

/**
 * Moves `value` to `toIndex` in code, through `onReorder`, held to the list, as an app's own buttons do:
 * where it is then, for its announcement, `moved` false when it was there already. `None`, and nothing
 * moved, for a value the group doesn't know.
 *
 * @example
 * Reorder.move(group, item, 0) // to the top
 */
// ADR-0037.
export const move: {
  <V>(value: V, toIndex: number): (group: Group<V>) => Option.Option<Placement>
  <V>(group: Group<V>, value: V, toIndex: number): Option.Option<Placement>
} = dual(3, <V>(group: Group<V>, value: V, toIndex: number): Option.Option<Placement> => {
  const values = group.options.values()
  return Option.flatMap(Arr.findFirstIndex(values, (v) => v === value), (from) => {
    const to = Math.min(Math.max(0, toIndex), values.length - 1)
    if (to === from) return placementIn(values, value, false)
    log(group, "move", { value, from, to })
    const next = moveItem(values, from, to)
    group.options.onReorder(next)
    return placementIn(next, value, true)
  })
})

// --- The keyboard reorder (ADR-0037) ----------------------------------------------

/**
 * What a key does to a keyboard reorder: Space or Enter lifts an item, or drops the lifted one
 * (`Toggle`); Escape cancels; an arrow steps the lifted item one place on screen; Home and End move it
 * to the first or last place. Any other key does nothing.
 */
// A **Keyboard reorder** (ADR-0037). Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
export type KeyIntent =
  | { readonly _tag: "Toggle" }
  | { readonly _tag: "Cancel" }
  | { readonly _tag: "Step"; readonly arrow: Arrow }
  | { readonly _tag: "End"; readonly end: "first" | "last" }

/** An arrow key, by where it points on screen. */
export type Arrow = "left" | "right" | "up" | "down"

const TOGGLE: KeyIntent = { _tag: "Toggle" }
const CANCEL: KeyIntent = { _tag: "Cancel" }
const stepTo = (arrow: Arrow): KeyIntent => ({ _tag: "Step", arrow })
const endTo = (end: "first" | "last"): KeyIntent => ({ _tag: "End", end })

/** What `key` does to a keyboard reorder, if anything: see `KeyIntent`. */
export const keyIntent = (key: InputSource.Key): Option.Option<KeyIntent> =>
  Match.value(key).pipe(
    Match.when(Match.is("space", "enter"), () => Option.some(TOGGLE)),
    Match.when("escape", () => Option.some(CANCEL)),
    Match.when(Match.is("left", "right", "up", "down"), (arrow) => Option.some(stepTo(arrow))),
    Match.when("home", () => Option.some(endTo("first"))),
    Match.when("end", () => Option.some(endTo("last"))),
    Match.orElse(() => Option.none()),
  )

/**
 * Where a lifted item goes for one arrow: its new index in `order`, by what's on screen, so an rtl row
 * or a reversed list moves the way the arrow points.
 * - **One axis:** only that axis's arrows act. The item takes the place of the neighbour, of the two next
 *   to it, whose centre lies the way the arrow points, as `check` chooses.
 * - **A grid** (`"xy"`): Left and Right step one place in reading order, flipped in rtl, wrapping across
 *   rows; Up and Down take the place of the item in the row above or below whose centre is nearest.
 *
 * With nowhere to go, at an end or for an arrow off the axis, it's `index`.
 */
// ADR-0037, Q4: the **Crossover** chooses its neighbour by position. Tier 2 (ADR-0008).
export const arrowTarget = <V>(order: ReadonlyArray<ItemData<V>>, index: number, arrow: Arrow, axis: Axis, direction: "ltr" | "rtl"): number =>
  Option.match(Arr.get(order, index), {
    onNone: () => index,
    onSome: (item) =>
      Match.value(axis).pipe(
        Match.when("xy", () => gridTarget(order, index, item, arrow, direction)),
        Match.orElse((single) => axisTarget(order, index, item, arrow, single)),
      ),
  })

/** Which way along `axis` an arrow points: `1` toward greater coordinates, `-1` toward smaller, `0` off it. */
const signOn = (arrow: Arrow, axis: "x" | "y"): number =>
  Match.value({ arrow, axis }).pipe(
    Match.when({ arrow: "right", axis: "x" }, () => 1),
    Match.when({ arrow: "left", axis: "x" }, () => -1),
    Match.when({ arrow: "down", axis: "y" }, () => 1),
    Match.when({ arrow: "up", axis: "y" }, () => -1),
    Match.orElse(() => 0),
  )

/** A single axis's step: the neighbour whose centre lies the way the arrow points, by position. */
const axisTarget = <V>(order: ReadonlyArray<ItemData<V>>, index: number, item: ItemData<V>, arrow: Arrow, axis: "x" | "y"): number => {
  const sign = signOn(arrow, axis)
  if (sign === 0) return index
  const forward = sign > 0
  const centre = centreOf(item.layout[axis])
  return Option.getOrElse(
    Option.orElse(
      Option.as(centreOnSide(order, index - 1, axis, centre, forward), index - 1),
      () => Option.as(centreOnSide(order, index + 1, axis, centre, forward), index + 1),
    ),
    () => index,
  )
}

/** A grid's step: reading order across, the nearest centre in the row above or below. */
const gridTarget = <V>(order: ReadonlyArray<ItemData<V>>, index: number, item: ItemData<V>, arrow: Arrow, direction: "ltr" | "rtl"): number =>
  Match.value(arrow).pipe(
    Match.when(Match.is("left", "right"), (across) => {
      const ahead = Bool.match(direction === "rtl", { onTrue: () => across === "left", onFalse: () => across === "right" })
      const next = index + Bool.match(ahead, { onTrue: () => 1, onFalse: () => -1 })
      return Bool.match(Bool.and(next >= 0, next < order.length), { onTrue: () => next, onFalse: () => index })
    }),
    Match.orElse((vertical) => {
      // The rows, top to bottom; the item's, and the one above or below it.
      const rows = Arr.sort(getLines(order), Order.mapInput(Num.Order, (line: Line<V>) => line.min))
      const own = Option.getOrElse(Arr.findFirstIndex(rows, (row) => row.items.includes(item)), () => -1)
      const x = centreOf(item.layout.x)
      return Arr.get(rows, own + Bool.match(vertical === "down", { onTrue: () => 1, onFalse: () => -1 })).pipe(
        Option.map((row) => Arr.min(row.items, Order.mapInput(Num.Order, (other: ItemData<V>) => Math.abs(centreOf(other.layout.x) - x)))),
        Option.flatMap((nearest) => Arr.findFirstIndex(order, (other) => other === nearest)),
        Option.getOrElse(() => index),
      )
    }),
  )

/** Where an item is after a keyboard reorder's step, for its announcement. */
// Tier 2 (ADR-0008).
export interface Placement {
  /** Its place in the order, from 1. */
  readonly position: number
  /** How many items the order has. */
  readonly count: number
  /** Whether this step moved it: not at an end. */
  readonly moved: boolean
  /**
   * Whether the step waited for the boxes to be measured: after a step they're the old order's until
   * they are, so a step read against them could go the wrong way. It moved nothing, and has nothing to
   * announce: a held arrow's repeat in that time is dropped.
   */
  // A Measure pass (ADR-0037).
  readonly waiting: boolean
}

/** `value`'s placement in `values`, `None` when it isn't in it. */
const placementIn = <V>(values: ReadonlyArray<V>, value: V, moved: boolean, waiting = false): Option.Option<Placement> =>
  Option.map(Arr.findFirstIndex(values, (v) => v === value), (index) => ({ position: index + 1, count: values.length, moved, waiting }))

/** The lifted item, when it's `value`. */
const liftOf = <V>(group: Group<V>, value: V): Option.Option<Lift<V>> => Option.filter(MutableRef.get(stateOf(group).lifted), (lift) => lift.value === value)

/**
 * Lifts `value`'s item for a keyboard reorder: its axis and direction are fixed now, as a drag's are at
 * its start, and the order kept for a cancel. Lifting another item drops the one lifted. `None` for a
 * value not in `values`.
 */
// ADR-0037.
export const lift: {
  <V>(value: V): (group: Group<V>) => Option.Option<Placement>
  <V>(group: Group<V>, value: V): Option.Option<Placement>
} = dual(isGroup, <V>(group: Group<V>, value: V): Option.Option<Placement> => {
  const values = group.options.values()
  return Option.map(placementIn(values, value, false), (placement) => {
    const axis = resolveAxis(group)
    const direction = directionOf(group)
    MutableRef.set(stateOf(group).lifted, Option.some({ value, origin: Arr.copy(values), axis, direction, guard: Option.none() }))
    log(group, "keyboard lift", { value, position: placement.position, axis, direction })
    return placement
  })
})

/**
 * One key's move of the lifted item: an arrow's step on screen (`arrowTarget`), or Home's or End's jump
 * to the first or last place, through `onReorder`. `moved` is false where it had nowhere to go. Until the
 * boxes are measured after its last step, a step waits (`waiting`, nothing moved), as a drag's next
 * reorder does. `None` when `value` isn't the lifted item.
 */
// ADR-0037: a Measure pass.
export const step: {
  <V>(value: V, intent: Extract<KeyIntent, { readonly _tag: "Step" | "End" }>): (group: Group<V>) => Option.Option<Placement>
  <V>(group: Group<V>, value: V, intent: Extract<KeyIntent, { readonly _tag: "Step" | "End" }>): Option.Option<Placement>
} = dual(3, <V>(group: Group<V>, value: V, intent: Extract<KeyIntent, { readonly _tag: "Step" | "End" }>): Option.Option<Placement> =>
  Option.flatMap(liftOf(group, value), (l) => {
    const values = group.options.values()
    const source = group.sources.get(value)
    const version = Option.match(Option.fromUndefinedOr(source), { onNone: () => 0, onSome: (s) => s.layoutVersion() })
    if (Option.exists(l.guard, (guard) => version <= guard)) return placementIn(values, value, false, true)
    l.guard = Option.none()
    const measured = measure(group, values)
    return Option.flatMap(Arr.findFirstIndex(measured, (item) => item.value === value), (index) => {
      const target = Match.value(intent).pipe(
        Match.tag("Step", ({ arrow }) => arrowTarget(measured, index, arrow, l.axis, l.direction)),
        Match.tag("End", ({ end }) => Bool.match(end === "first", { onTrue: () => 0, onFalse: () => measured.length - 1 })),
        Match.exhaustive,
      )
      if (target === index) return placementIn(values, value, false)
      const newValues = refill(values, measured, moveItem(measured, index, target))
      log(group, "keyboard step", { value, from: Arr.getUnsafe(measured, index).index, to: Arr.getUnsafe(measured, target).index })
      l.guard = Option.some(version)
      group.options.onReorder(newValues)
      return placementIn(newValues, value, true)
    })
  }))

/** Drops the lifted item where it is: its placement, `None` when `value` isn't lifted. */
// ADR-0037.
export const drop: {
  <V>(value: V): (group: Group<V>) => Option.Option<Placement>
  <V>(group: Group<V>, value: V): Option.Option<Placement>
} = dual(isGroup, <V>(group: Group<V>, value: V): Option.Option<Placement> =>
  Option.flatMap(liftOf(group, value), () => {
    MutableRef.set(stateOf(group).lifted, Option.none())
    const placement = placementIn(group.options.values(), value, false)
    log(group, "keyboard drop", { value, position: Option.map(placement, (p) => p.position) })
    return placement
  }))

/**
 * Cancels the keyboard reorder: the order from the lift comes back through `onReorder`, when it changed,
 * and the item's placement there. `None` when `value` isn't lifted.
 */
// ADR-0037.
export const cancel: {
  <V>(value: V): (group: Group<V>) => Option.Option<Placement>
  <V>(group: Group<V>, value: V): Option.Option<Placement>
} = dual(isGroup, <V>(group: Group<V>, value: V): Option.Option<Placement> =>
  Option.flatMap(liftOf(group, value), (l) => {
    MutableRef.set(stateOf(group).lifted, Option.none())
    const values = group.options.values()
    const restored = restore(values, l.origin, value)
    if (Bool.not(sameOrder(restored, values))) group.options.onReorder(restored)
    log(group, "keyboard cancel", { value })
    return placementIn(restored, value, false)
  }))

/**
 * The order from the lift, as far as `values` still holds it: `value` back at its index there, the
 * rest in their current order. Only the lifted item moved during the lift, so this is the lift's
 * order unless the app changed `values` (which drops the lift first).
 */
const restore = <V>(values: ReadonlyArray<V>, origin: ReadonlyArray<V>, value: V): Array<V> =>
  Option.match(Arr.findFirstIndex(values, (v) => v === value), {
    onNone: () => Arr.copy(values),
    onSome: (from) => moveItem(values, from, Option.getOrElse(Arr.findFirstIndex(origin, (v) => v === value), () => from)),
  })

/** The lifted value, while a keyboard reorder runs. */
export const liftedValue = <V>(group: Group<V>): Option.Option<V> => Option.map(MutableRef.get(stateOf(group).lifted), (l) => l.value)

/** Whether a drag gesture runs in `group`. */
// #618 (F1): dom's keyboard reorder read the group's gesture ref for this.
export const isDragging = <V>(group: Group<V>): boolean => Option.isSome(MutableRef.get(stateOf(group).gesture))

/** Whether an item of `group` is lifted, by its keys (a **Keyboard reorder**, ADR-0037). */
// #618 (F1).
export const isLifted = <V>(group: Group<V>): boolean => Option.isSome(MutableRef.get(stateOf(group).lifted))

// --- The keyboard reorder's wording (ADR-0037) ---------------------------------------

/** What an announcement says about an item. */
// Tier 2 (ADR-0008).
export interface AnnouncementInfo<V> {
  /** The item's value. */
  readonly value: V
  /** What it's spoken as: its name, as the Environment reads it. */
  readonly label: string
  /** Its place in the list, from 1. */
  readonly position: number
  /** How many items the list has. */
  readonly count: number
}

/**
 * What a group announces: one for each moment of a keyboard reorder, and `move` for a move in code, an
 * app's own buttons. A group overrides any of them, and its instructions, for translation or tone.
 *
 * @example
 * const announcements: Reorder.Announcements<Task> = {
 *   ...Reorder.defaultAnnouncements,
 *   drop: ({ label, position }) => `${label} is now number ${position}.`,
 * }
 */
// ADR-0037. Tier 2 (ADR-0008).
export interface Announcements<V> {
  /** An item lifted: "Picked up Milk, position 2 of 5." */
  readonly lift: (info: AnnouncementInfo<V>) => string
  /** The lifted item stepped: "Milk, position 3 of 5." */
  readonly step: (info: AnnouncementInfo<V>) => string
  /** The lifted item dropped: "Dropped Milk at position 3 of 5." */
  readonly drop: (info: AnnouncementInfo<V>) => string
  /** The reorder cancelled: "Cancelled. Milk is back at position 2 of 5." */
  readonly cancel: (info: AnnouncementInfo<V>) => string
  /** An item moved in code: "Moved Milk to position 1 of 5." */
  readonly move: (info: AnnouncementInfo<V>) => string
}

/** The default announcements, in English: each member's example is its wording. */
// ADR-0037, Q6.
export const defaultAnnouncements: Announcements<unknown> = {
  lift: ({ label, position, count }) => `Picked up ${label}, position ${position} of ${count}.`,
  step: ({ label, position, count }) => `${label}, position ${position} of ${count}.`,
  drop: ({ label, position, count }) => `Dropped ${label} at position ${position} of ${count}.`,
  cancel: ({ label, position, count }) => `Cancelled. ${label} is back at position ${position} of ${count}.`,
  move: ({ label, position, count }) => `Moved ${label} to position ${position} of ${count}.`,
}

/**
 * The default instructions for an item, in English: the keys. An Environment adds what its own assistive
 * technology needs, as `@wardic/dom`'s `DEFAULT_REORDER_INSTRUCTIONS` does.
 */
// ADR-0037, Q8: the keys, as Q3 sets them.
export const DEFAULT_INSTRUCTIONS = "Press Space or Enter to pick up. Use the arrow keys to move, Space or Enter to drop, Escape to cancel."
