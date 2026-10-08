import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constVoid } from "effect/Function"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type { Box } from "../layout/box.ts"
import type { Point } from "../math/index.ts"
import { checkReorder, moveItem } from "./check-reorder.ts"
import { detectAxis } from "./detect-axis.ts"
import type { ReorderAxis, ReorderItemData } from "./types.ts"
import { type TimedPoint, trailingVelocity } from "./velocity.ts"

/**
 * What a **Reorder group** reads from one item: its layout box (the slot, `None`
 * before it's measured), how far it's dragged from that slot, and a count that rises
 * each time a Measure pass reads its box. A projection node's handle provides all
 * three (ADR-0016, *Amendment (Reorder)*); the group pulls them, it isn't pushed to.
 *
 * Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and Environment authors.
 */
export interface ReorderItemSource {
  readonly layoutBox: () => Option.Option<Box>
  readonly dragOffset: () => Point
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
export interface ReorderGroupOptions<V> {
  readonly values: () => ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: (() => Option.Option<ReorderAxis>) | undefined
  readonly direction?: (() => "ltr" | "rtl") | undefined
  readonly debug?: ((event: string, annotations: Record<string, unknown>) => void) | undefined
}

/**
 * A **Reorder group**: the items registered by value, and one drag gesture at a time.
 *
 * - `register(value, source)` adds an item (a value has one source; the returned
 *   function removes it). An unregistered value stays in `values` at its index.
 * - `resolveAxis()` is the override, else {@link detectAxis} over the measured items'
 *   boxes in `values` order.
 * - `dragStart` fixes the gesture's axis and direction and returns the axis;
 *   `dragMove` runs the **Crossover** for the dragged item and returns the pointer's
 *   velocity over the last 100 ms (its direction, for Auto-scroll); `dragEnd` ends it.
 * - `move(value, toIndex)` moves a value in code (clamped to the list, an unknown
 *   value ignored).
 *
 * Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and Environment authors.
 */
export interface ReorderGroup<V> {
  readonly register: (value: V, source: ReorderItemSource) => () => void
  readonly resolveAxis: () => ReorderAxis
  readonly dragStart: (value: V, point: Point, timeStamp: number) => ReorderAxis
  readonly dragMove: (value: V, point: Point, timeStamp: number) => Point
  readonly dragEnd: (value: V) => void
  readonly move: (value: V, toIndex: number) => void
}

/** How many points the direction keeps: enough for 100 ms of pointer events at 60–120 Hz. */
const RING = 12

const ZERO: Point = { x: 0, y: 0 }

interface Gesture<V> {
  readonly value: V
  readonly axis: ReorderAxis
  readonly direction: "ltr" | "rtl"
  /** The dragged item's `layoutVersion()` at the last reorder, until a Measure pass passes it. */
  guard: Option.Option<number>
  /** Whether this guard's wait has been logged. */
  waited: boolean
}

/** A mutable scratch entry of the measured order, reused across samples. */
/** A measured item, with its index in `values`. */
interface Measured<V> extends ReorderItemData<V> {
  readonly index: number
}

/**
 * Build a **Reorder group** (ADR-0020). Each drag sample reads the measured items'
 * boxes and the dragged item's offset from their sources, runs the **Crossover**
 * (Motion's `checkReorder`, with the single-axis neighbour chosen by position), and on
 * a new order maps it back onto `values`, keeping unmeasured values at their indexes
 * (Motion's Group.tsx:160-166 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), then calls
 * `onReorder`. After a reorder it waits until the dragged item's `layoutVersion()`
 * rises, so a sample read against the boxes from before the reorder can't swap it
 * back; Motion waits for React's next commit (its guard is set at Group.tsx:158 and
 * cleared by an effect at :172-174). The registry is a plain `Map` keyed by value.
 *
 * Per sample it allocates only the velocity point (and a new order on a reorder).
 *
 * Tier 2 (ADR-0008, as amended by ADR-0025): Effect-native, for binding and Environment authors.
 */
export const makeReorderGroup = <V>(options: ReorderGroupOptions<V>): ReorderGroup<V> => {
  const sources = new Map<V, ReorderItemSource>()
  const gesture = MutableRef.make(Option.none<Gesture<V>>())
  const log = (event: string, annotations: Record<string, unknown>): void => {
    if (Predicate.isNotUndefined(options.debug)) options.debug(event, annotations)
  }

  // The direction's points: the last RING samples, oldest first.
  const history = MutableRef.make<ReadonlyArray<TimedPoint>>([])
  const record = (point: Point, timeStamp: number): void => {
    MutableRef.update(history, (points) => Arr.takeRight(Arr.append(points, { x: point.x, y: point.y, timeStamp }), RING))
  }
  const clearHistory = (): void => {
    MutableRef.set(history, [])
  }

  /** An item's box, while it is registered and has one. */
  const layoutOf = (value: V): Option.Option<Box> =>
    Option.flatMap(Option.fromUndefinedOr(sources.get(value)), (source) => source.layoutBox())

  // The measured order: each value with a box, and its index in `values`.
  const measure = (values: ReadonlyArray<V>): ReadonlyArray<Measured<V>> =>
    Arr.getSomes(Arr.map(values, (value, index) => Option.map(layoutOf(value), (layout) => ({ value, layout, index }))))

  const resolveAxis = (): ReorderAxis =>
    Option.fromUndefinedOr(options.axis).pipe(
      Option.flatMap((axis) => axis()),
      Option.getOrElse(() => detectAxis(Arr.map(measure(options.values()), (item) => item.layout))),
    )

  /**
   * After a reorder, the drag waits until a Measure pass has measured the new order: true while
   * it waits (logged once), false once the item's layout has moved past the guard.
   */
  const waiting = (g: Gesture<V>, value: V, source: ReorderItemSource): boolean =>
    Option.match(g.guard, {
      onNone: () => false,
      onSome: (guard) =>
        Bool.match(source.layoutVersion() <= guard, {
          onTrue: () => {
            if (!g.waited) {
              g.waited = true
              log("reorder waits", { value })
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
  const reorderOn = (g: Gesture<V>, value: V, source: ReorderItemSource, velocity: Point): void => {
    if (waiting(g, value, source)) return
    const values = options.values()
    const measured = measure(values)
    const next = checkReorder(measured, value, source.dragOffset(), velocity, g.axis, g.direction)
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
    log("reorder", { value, from: indexIn(values), to: indexIn(newValues), axis: g.axis, direction: g.direction })
    options.onReorder(newValues)
  }

  return {
    register: (value, source) => {
      sources.set(value, source)
      return () => {
        if (sources.get(value) === source) sources.delete(value)
      }
    },
    resolveAxis,
    dragStart: (value, point, timeStamp) => {
      const axis = resolveAxis()
      const direction = Option.fromUndefinedOr(options.direction).pipe(
        Option.flatMap((directionOf) => Option.fromNullishOr(directionOf())),
        Option.getOrElse((): "ltr" | "rtl" => "ltr"),
      )
      MutableRef.set(gesture, Option.some({ value, axis, direction, guard: Option.none(), waited: false }))
      clearHistory()
      record(point, timeStamp)
      log("reorder start", { value, axis, direction })
      return axis
    },
    dragMove: (value, point, timeStamp) =>
      Option.match(Option.filter(MutableRef.get(gesture), (g) => g.value === value), {
        onNone: () => ZERO,
        onSome: (g) => {
          record(point, timeStamp)
          const velocity = trailingVelocity(MutableRef.get(history), 100)
          Option.match(Option.fromUndefinedOr(sources.get(value)), {
            onNone: constVoid,
            onSome: (source) => reorderOn(g, value, source, velocity),
          })
          return velocity
        },
      }),
    dragEnd: (value) => {
      if (Option.exists(MutableRef.get(gesture), (g) => g.value === value)) {
        MutableRef.set(gesture, Option.none())
        clearHistory()
      }
    },
    move: (value, toIndex) => {
      const values = options.values()
      Option.match(Arr.findFirstIndex(values, (v) => v === value), {
        onNone: constVoid,
        onSome: (from) => {
          const to = Math.min(Math.max(0, toIndex), values.length - 1)
          if (to === from) return
          log("move", { value, from, to })
          options.onReorder(moveItem(values, from, to))
        },
      })
    },
  }
}
