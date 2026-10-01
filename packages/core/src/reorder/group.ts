import type { Box } from "../layout/box.ts"
import type { Point } from "../math/index.ts"
import { checkReorder, moveItem } from "./check-reorder.ts"
import { detectAxis } from "./detect-axis.ts"
import type { ReorderAxis, ReorderItemData } from "./types.ts"
import { type TimedPoint, trailingVelocity } from "./velocity.ts"

/**
 * What a **Reorder group** reads from one item: its layout box (the slot, `undefined`
 * before it's measured), how far it's dragged from that slot, and a count that rises
 * each time a Measure pass reads its box. A projection node's handle provides all
 * three (ADR-0016, *Amendment (Reorder)*); the group pulls them, it isn't pushed to.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface ReorderItemSource {
  readonly layoutBox: () => Box | undefined
  readonly dragOffset: () => Point
  readonly layoutVersion: () => number
}

/**
 * A **Reorder group**'s inputs. `values` is the app's order, read when it's needed;
 * `onReorder` receives each new order (the app sets it, as with Motion's). `axis`
 * overrides the detected axis, read at each drag start; `direction` is the group's
 * inline direction (`"ltr"` when absent), read at each drag start. `debug` receives the
 * cold-path events: `reorder` { value, from, to, axis, direction } once per reorder,
 * `reorder waits` { value } once per wait for a Measure pass, `reorder start`
 * { value, axis, direction } and `move` { value, from, to }.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface ReorderGroupOptions<V> {
  readonly values: () => ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: (() => ReorderAxis | undefined) | undefined
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
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
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
  guard: number | undefined
  /** Whether this guard's wait has been logged. */
  waited: boolean
}

/** A mutable scratch entry of the measured order, reused across samples. */
interface Scratch<V> {
  value: V
  layout: Box
}

/**
 * Build a **Reorder group** (ADR-0020). Each drag sample reads the measured items'
 * boxes and the dragged item's offset from their sources, runs the **Crossover**
 * (Motion's `checkReorder`, with the single-axis neighbour chosen by position), and on
 * a new order maps it back onto `values`, keeping unmeasured values at their indexes
 * (Motion's Group.tsx:150-160 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), then calls
 * `onReorder`. After a reorder it waits until the dragged item's `layoutVersion()`
 * rises, so a sample read against the boxes from before the reorder can't swap it
 * back; Motion waits for React's next commit (Group.tsx:163-165). The registry is a
 * plain `Map` keyed by value.
 *
 * Per sample it allocates only the velocity point (and a new order on a reorder).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const makeReorderGroup = <V>(options: ReorderGroupOptions<V>): ReorderGroup<V> => {
  const sources = new Map<V, ReorderItemSource>()
  const debug = options.debug
  let gesture: Gesture<V> | undefined

  // The direction's points: a ring written round-robin, and an ordered view of it.
  const ring: Array<{ x: number; y: number; timeStamp: number }> = Array.from({ length: RING }, () => ({ x: 0, y: 0, timeStamp: 0 }))
  const view: Array<TimedPoint> = []
  let head = 0
  let count = 0
  const record = (point: Point, timeStamp: number): void => {
    const slot = ring[head]!
    slot.x = point.x
    slot.y = point.y
    slot.timeStamp = timeStamp
    head = (head + 1) % RING
    if (count < RING) count++
    view.length = count
    const first = (head - count + RING) % RING
    for (let i = 0; i < count; i++) view[i] = ring[(first + i) % RING]!
  }
  const clearRing = (): void => {
    head = 0
    count = 0
    view.length = 0
  }

  // The measured order, reused across samples, and each entry's index in `values`.
  const order: Array<Scratch<V>> = []
  const indexes: Array<number> = []
  const measure = (values: ReadonlyArray<V>): Array<ReorderItemData<V>> => {
    let k = 0
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!
      const layout = sources.get(value)?.layoutBox()
      if (layout === undefined) continue
      const entry = order[k]
      if (entry === undefined) order[k] = { value, layout }
      else {
        entry.value = value
        entry.layout = layout
      }
      indexes[k] = i
      k++
    }
    order.length = k
    indexes.length = k
    return order
  }

  const resolveAxis = (): ReorderAxis => {
    const override = options.axis?.()
    if (override !== undefined) return override
    return detectAxis(measure(options.values()).map((item) => item.layout))
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
      const direction = options.direction?.() ?? "ltr"
      gesture = { value, axis, direction, guard: undefined, waited: false }
      clearRing()
      record(point, timeStamp)
      debug?.("reorder start", { value, axis, direction })
      return axis
    },
    dragMove: (value, point, timeStamp) => {
      const g = gesture
      if (g === undefined || g.value !== value) return ZERO
      record(point, timeStamp)
      const velocity = trailingVelocity(view, 100)
      const source = sources.get(value)
      if (source === undefined) return velocity
      if (g.guard !== undefined) {
        if (source.layoutVersion() <= g.guard) {
          if (!g.waited) {
            g.waited = true
            debug?.("reorder waits", { value })
          }
          return velocity
        }
        g.guard = undefined
        g.waited = false
      }
      const values = options.values()
      const measured = measure(values)
      const next = checkReorder(measured, value, source.dragOffset(), velocity, g.axis, g.direction)
      if (next === measured) return velocity
      const newValues = [...values]
      for (let i = 0; i < next.length; i++) newValues[indexes[i]!] = next[i]!.value
      const from = values.indexOf(value)
      const to = newValues.indexOf(value)
      g.guard = source.layoutVersion()
      g.waited = false
      debug?.("reorder", { value, from, to, axis: g.axis, direction: g.direction })
      options.onReorder(newValues)
      return velocity
    },
    dragEnd: (value) => {
      if (gesture?.value !== value) return
      gesture = undefined
      clearRing()
    },
    move: (value, toIndex) => {
      const values = options.values()
      const from = values.indexOf(value)
      if (from === -1) return
      const to = Math.min(Math.max(0, toIndex), values.length - 1)
      if (to === from) return
      debug?.("move", { value, from, to })
      options.onReorder(moveItem(values, from, to))
    },
  }
}
