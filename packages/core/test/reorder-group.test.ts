import type * as Box from "@wardic/core/Box"
import * as Reorder from "@wardic/core/Reorder"
import * as Option from "effect/Option"
import { describe, expect, it } from "@effect/vitest"

// The Reorder group (ADR-0020): core's framework-free `makeReorderGroup`, checked
// against fake item sources. A fake source stands in for a projection handle (ADR-0016,
// *Amendment (Reorder)*): its box, its drag offset and its layoutVersion are plain
// fields the test sets, as the engine would. `pass()` plays a Measure pass after a
// reorder: each value takes the slot of its index, and every measured source's
// version rises.

const box = (left: number, top: number, right: number, bottom: number): Box.Box => ({
  x: { min: left, max: right },
  y: { min: top, max: bottom },
})

/** A column's slot at index `i`: 200 x 50, 10 px apart (centres 25, 85, 145, 205, 265). */
const slot = (i: number): Box.Box => box(0, 60 * i, 200, 60 * i + 50)
/** A row's slot at index `i`: 80 x 50, 10 px apart. */
const rowSlot = (i: number): Box.Box => box(90 * i, 0, 90 * i + 80, 50)

interface FakeSource extends Reorder.ReorderItemSource {
  layout: Box.Box | undefined
  offset: { x: number; y: number }
  version: number
}

const fakeSource = (layout: Box.Box | undefined): FakeSource => {
  const s: FakeSource = {
    layout,
    offset: { x: 0, y: 0 },
    version: layout === undefined ? 0 : 1,
    layoutBox: () => Option.fromUndefinedOr(s.layout),
    dragOffset: () => s.offset,
    layoutVersion: () => s.version,
  }
  return s
}

const harness = <V,>(
  initial: ReadonlyArray<V>,
  options: {
    readonly measured?: ReadonlyArray<V>
    readonly slotOf?: (i: number) => Box.Box
    readonly axis?: () => Reorder.Axis | undefined
    readonly direction?: () => "ltr" | "rtl"
  } = {},
) => {
  const slotOf = options.slotOf ?? slot
  const state = {
    values: [...initial] as Array<V>,
    calls: [] as Array<ReadonlyArray<V>>,
    events: [] as Array<{ event: string; annotations: Record<string, unknown> }>,
    sources: new Map<V, FakeSource>(),
  }
  const group = Reorder.makeReorderGroup<V>({
    values: () => state.values,
    onReorder: (next) => {
      state.calls.push(next)
      state.values = next
    },
    axis: () => Option.flatMap(Option.fromUndefinedOr(options.axis), (axis) => Option.fromUndefinedOr(axis())),
    ...(options.direction !== undefined ? { direction: options.direction } : {}),
    debug: (event, annotations) => state.events.push({ event, annotations }),
  })
  const measured = options.measured ?? initial
  initial.forEach((v, i) => {
    if (!measured.includes(v)) return
    const s = fakeSource(slotOf(i))
    state.sources.set(v, s)
    group.register(v, s)
  })
  /** A Measure pass after a reorder: slots follow `values`, versions rise. */
  const pass = (of: (i: number) => Box.Box = slotOf): void => {
    state.values.forEach((v, i) => {
      const s = state.sources.get(v)
      if (s !== undefined) {
        s.layout = of(i)
        s.version++
      }
    })
  }
  /**
   * A vertical gesture on `value`, grabbed at its slot's centre at time `t0`. `to(dy)`
   * moves the pointer to `dy` px below the grab point, 50 ms after the last sample, and
   * sets the engine's offset as a pass would: the grab slot plus `dy`, minus the slot
   * the item has now.
   */
  const gesture = (value: V, t0 = 0) => {
    const s = state.sources.get(value)!
    const grab = s.layout!
    const y0 = (grab.y.min + grab.y.max) / 2
    let t = t0
    const axis = group.dragStart(value, { x: 100, y: y0 }, t0)
    return {
      axis,
      to: (dy: number) => {
        t += 50
        s.offset = { x: 0, y: grab.y.min + dy - s.layout!.y.min }
        return group.dragMove(value, { x: 100, y: y0 + dy }, t)
      },
      end: () => group.dragEnd(value),
    }
  }
  return { state, group, pass, gesture }
}

describe("makeReorderGroup", () => {
  it("RG1: register and unregister by value; an unregistered value is left out of the order but kept in values", () => {
    const h = harness(["a", "b", "c"])
    // b leaves the registry (e.g. virtualized off-screen): it is no longer measured.
    h.group.register("b", h.state.sources.get("b")!)()
    const g = h.gesture("a")
    // Measured order [a, c]: a's bottom 50 passes c's centre 145 at +96. The new order
    // [c, a] goes back into the measured indexes 0 and 2; b keeps index 1.
    for (const dy of [30, 60, 90, 96]) g.to(dy)
    expect(h.state.calls).toEqual([["c", "b", "a"]])
  })

  it("RG2: dragStart returns the axis override when given, else detectAxis over the measured boxes", () => {
    expect(harness(["a", "b", "c"]).group.dragStart("a", { x: 0, y: 0 }, 0)).toBe("y")
    expect(harness(["a", "b", "c"], { slotOf: rowSlot }).group.dragStart("a", { x: 0, y: 0 }, 0)).toBe("x")
    expect(harness(["a", "b", "c"], { axis: () => "x" }).group.dragStart("a", { x: 0, y: 0 }, 0)).toBe("x")
    // Fewer than two measured items: "y", Motion's starting axis.
    expect(harness(["a", "b", "c"], { measured: ["a"] }).group.dragStart("a", { x: 0, y: 0 }, 0)).toBe("y")
  })

  it("RG3: the axis is fixed for the gesture; an override changed mid-gesture applies at the next dragStart", () => {
    let override: Reorder.Axis | undefined = "y"
    const h = harness(["a", "b", "c"], { axis: () => override })
    const g = h.gesture("a")
    override = "x"
    // Still a y gesture: a's bottom 50 + 36 passes b's centre 85.
    for (const dy of [20, 36]) g.to(dy)
    expect(h.state.calls).toEqual([["b", "a", "c"]])
    g.end()
    expect(h.group.dragStart("b", { x: 0, y: 0 }, 1000)).toBe("x")
  })

  it("RG4: a slow drag (moves 50 ms apart) past one neighbour reorders once", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    const g = h.gesture("b")
    // b's bottom 110 + 40 = 150 passes c's centre 145.
    for (const dy of [10, 20, 30, 40]) g.to(dy)
    expect(h.state.calls).toEqual([["a", "c", "b", "d", "e"]])
  })

  it("RG5: after a reorder, no further one until the dragged item's layoutVersion rises", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    const g = h.gesture("b")
    for (const dy of [10, 20, 30, 40]) g.to(dy)
    expect(h.state.calls).toHaveLength(1)
    // Before a pass the boxes are stale: b still reads slot 1 and c slot 2, so with the new
    // order [a, c, b, …] b "passes" c again and would swap back. The guard holds.
    for (const dy of [50, 60, 70]) g.to(dy)
    expect(h.state.calls).toHaveLength(1)
    // The pass measures the new order (b in slot 2, 120-170): no crossing at +76 ...
    h.pass()
    g.to(76)
    expect(h.state.calls).toHaveLength(1)
    // ... and at +96 b's bottom 170 + 36 = 206 passes d's centre 205.
    g.to(96)
    expect(h.state.calls).toEqual([
      ["a", "c", "b", "d", "e"],
      ["a", "c", "d", "b", "e"],
    ])
  })

  it("RG6: unmeasured values keep their indexes (Motion's virtualized-list test, index.test.tsx:66-100)", () => {
    // Motion's boxes: 2 at 0-50, 3 at 50-100, 4 at 100-150; 1 and 5 unmeasured.
    const h = harness([1, 2, 3, 4, 5], { measured: [2, 3, 4], slotOf: (i) => box(0, 50 * (i - 1), 100, 50 * i) })
    const g = h.gesture(2)
    // 2's bottom 50 + 30 = 80 passes 3's centre 75.
    for (const dy of [15, 30]) g.to(dy)
    expect(h.state.calls).toEqual([[1, 3, 2, 4, 5]])
  })

  it("RG7: the direction (ltr or rtl) is read once per drag start", () => {
    let reads = 0
    const cell = (i: number): Box.Box => {
      const x = 100 * (i % 2)
      const y = 100 * Math.floor(i / 2)
      return box(x, y, x + 100, y + 100)
    }
    const h = harness(["a", "b", "c", "d"], {
      slotOf: cell,
      direction: () => {
        reads++
        return "ltr"
      },
    })
    expect(h.group.dragStart("a", { x: 50, y: 50 }, 0)).toBe("xy")
    for (let k = 1; k <= 5; k++) h.group.dragMove("a", { x: 50 + 5 * k, y: 50 }, 50 * k)
    expect(reads).toBe(1)
    h.group.dragEnd("a")
    h.group.dragStart("a", { x: 50, y: 50 }, 1000)
    expect(reads).toBe(2)
  })

  it("RG8: move(value, toIndex) reorders through onReorder, and does nothing for the same index", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    h.group.move("a", 2)
    expect(h.state.calls).toEqual([["b", "c", "a", "d", "e"]])
    h.group.move("a", 2)
    expect(h.state.calls).toHaveLength(1)
  })

  it("RG9: move clamps the index and ignores an unknown value", () => {
    const h = harness(["a", "b", "c"])
    h.group.move("a", 99)
    expect(h.state.calls).toEqual([["b", "c", "a"]])
    h.group.move("b", -5) // b is already first: clamped to 0, nothing to do
    h.group.move("zz", 1)
    expect(h.state.calls).toHaveLength(1)
  })

  it("RG10: one `reorder` debug event per reorder, and one `reorder waits` per guarded wait", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    const g = h.gesture("b")
    for (const dy of [10, 20, 30, 40, 50, 60, 70, 80]) g.to(dy) // the reorder at +40, then 4 guarded samples
    const reorders = h.state.events.filter((e) => e.event === "reorder")
    expect(reorders).toHaveLength(1)
    expect(reorders[0]!.annotations).toMatchObject({ value: "b", from: 1, to: 2, axis: "y" })
    expect(h.state.events.filter((e) => e.event === "reorder waits")).toHaveLength(1)
  })

  it("RG11: dragEnd clears the guard and the direction history", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    const g = h.gesture("b")
    for (const dy of [10, 20, 30, 40]) g.to(dy) // a reorder: the guard is armed
    g.end()
    // A new gesture on e, moving UP: no pass has run, yet the guard doesn't hold it, and
    // its direction comes only from its own points (b's downward history is gone).
    const e = h.gesture("e", 2000)
    // e's top 240 - 36 = 204 passes d's centre 205.
    const v = e.to(-36)
    expect(v.y).toBeLessThan(0)
    expect(h.state.calls.at(-1)).toEqual(["a", "c", "b", "e", "d"])
  })

  it("RG12: resolveAxis reads the boxes afresh on each call", () => {
    const h = harness(["a", "b", "c"])
    expect(h.group.resolveAxis()).toBe("y")
    h.pass(rowSlot)
    expect(h.group.resolveAxis()).toBe("x")
  })

  it("RG13: the Crossover uses the source's dragOffset and layoutBox at that sample, not the sample's point", () => {
    const h = harness(["a", "b", "c"])
    const a = h.state.sources.get("a")!
    h.group.dragStart("a", { x: 100, y: 25 }, 0)
    // The point says a is far down, but the engine says it hasn't moved: no reorder.
    a.offset = { x: 0, y: 0 }
    h.group.dragMove("a", { x: 100, y: 400 }, 50)
    h.group.dragMove("a", { x: 100, y: 500 }, 100)
    expect(h.state.calls).toHaveLength(0)
    // The point barely moves (still downward), but the engine's offset passes b's centre.
    a.offset = { x: 0, y: 36 }
    h.group.dragMove("a", { x: 100, y: 501 }, 150)
    expect(h.state.calls).toEqual([["b", "a", "c"]])
  })
})
