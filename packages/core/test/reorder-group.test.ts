import type * as Box from "@wardic/core/Box"
import * as Reorder from "@wardic/core/Reorder"
import * as Velocity from "@wardic/core/Velocity"
import * as Option from "effect/Option"
import { describe, expect, expectTypeOf, it } from "@effect/vitest"

// The Reorder group (ADR-0020): core's framework-free `Reorder.Group`, checked
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

interface FakeSource extends Reorder.ItemSource {
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
  const group = Reorder.make<V>({
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
    Reorder.register(group, v, s)
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
   * moves the pointer to `dy` px below the grab point, 50 ms after the last sample, with
   * the velocity a drag sample would carry (the pointer's over its last 100 ms, from the
   * grab), and sets the engine's offset as a pass would: the grab slot plus `dy`, minus
   * the slot the item has now.
   */
  const gesture = (value: V, t0 = 0) => {
    const s = state.sources.get(value)!
    const grab = s.layout!
    const y0 = (grab.y.min + grab.y.max) / 2
    let t = t0
    let points: ReadonlyArray<Velocity.TimedPoint> = [{ x: 100, y: y0, timeStamp: t0 }]
    const axis = Reorder.dragStart(group, value)
    return {
      axis,
      to: (dy: number) => {
        t += 50
        s.offset = { x: 0, y: grab.y.min + dy - s.layout!.y.min }
        points = [...points, { x: 100, y: y0 + dy, timeStamp: t }]
        return Reorder.dragMove(group, value, Velocity.trailing(points, 100))
      },
      end: () => Reorder.dragEnd(group, value),
    }
  }
  return { state, group, pass, gesture }
}

describe("Reorder.Group", () => {
  it("RG1: register and unregister by value; an unregistered value is left out of the order but kept in values", () => {
    const h = harness(["a", "b", "c"])
    // b leaves the registry (e.g. virtualized off-screen): it is no longer measured.
    Reorder.register(h.group, "b", h.state.sources.get("b")!)()
    const g = h.gesture("a")
    // Measured order [a, c]: a's bottom 50 passes c's centre 145 at +96. The new order
    // [c, a] goes back into the measured indexes 0 and 2; b keeps index 1.
    for (const dy of [30, 60, 90, 96]) g.to(dy)
    expect(h.state.calls).toEqual([["c", "b", "a"]])
  })

  it("RG2: dragStart returns the axis override when given, else detectAxis over the measured boxes", () => {
    expect(Reorder.dragStart(harness(["a", "b", "c"]).group, "a")).toBe("y")
    expect(Reorder.dragStart(harness(["a", "b", "c"], { slotOf: rowSlot }).group, "a")).toBe("x")
    expect(Reorder.dragStart(harness(["a", "b", "c"], { axis: () => "x" }).group, "a")).toBe("x")
    // Fewer than two measured items: "y", Motion's starting axis.
    expect(Reorder.dragStart(harness(["a", "b", "c"], { measured: ["a"] }).group, "a")).toBe("y")
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
    expect(Reorder.dragStart(h.group, "b")).toBe("x")
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
    expect(Reorder.dragStart(h.group, "a")).toBe("xy")
    for (let k = 1; k <= 5; k++) Reorder.dragMove(h.group, "a", { x: 100, y: 0 })
    expect(reads).toBe(1)
    Reorder.dragEnd(h.group, "a")
    Reorder.dragStart(h.group, "a")
    expect(reads).toBe(2)
  })

  it("RG8: move(value, toIndex) reorders through onReorder, and does nothing for the same index", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    Reorder.move(h.group, "a", 2)
    expect(h.state.calls).toEqual([["b", "c", "a", "d", "e"]])
    Reorder.move(h.group, "a", 2)
    expect(h.state.calls).toHaveLength(1)
  })

  it("RG9: move clamps the index and ignores an unknown value", () => {
    const h = harness(["a", "b", "c"])
    Reorder.move(h.group, "a", 99)
    expect(h.state.calls).toEqual([["b", "c", "a"]])
    Reorder.move(h.group, "b", -5) // b is already first: clamped to 0, nothing to do
    Reorder.move(h.group, "zz", 1)
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

  it("RG11: dragEnd clears the guard; the next gesture moves at its own samples' velocity", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    const g = h.gesture("b")
    for (const dy of [10, 20, 30, 40]) g.to(dy) // a reorder: the guard is armed
    g.end()
    // A new gesture on e, moving UP: no pass has run, yet the guard doesn't hold it, and
    // its direction is its own sample's (the group keeps nothing of b's downward drag).
    const e = h.gesture("e", 2000)
    // e's top 240 - 36 = 204 passes d's centre 205.
    const v = e.to(-36)
    expect(v.y).toBeLessThan(0)
    expect(h.state.calls.at(-1)).toEqual(["a", "c", "b", "e", "d"])
  })

  it("RG12: resolveAxis reads the boxes afresh on each call", () => {
    const h = harness(["a", "b", "c"])
    expect(Reorder.resolveAxis(h.group)).toBe("y")
    h.pass(rowSlot)
    expect(Reorder.resolveAxis(h.group)).toBe("x")
  })

  it("RG13: the Crossover uses the source's dragOffset and layoutBox at that sample; the velocity gives only its direction", () => {
    const h = harness(["a", "b", "c"])
    const a = h.state.sources.get("a")!
    Reorder.dragStart(h.group, "a")
    // The pointer is moving down fast, but the engine says a hasn't moved: no reorder.
    a.offset = { x: 0, y: 0 }
    Reorder.dragMove(h.group, "a", { x: 0, y: 7000 })
    Reorder.dragMove(h.group, "a", { x: 0, y: 2000 })
    expect(h.state.calls).toHaveLength(0)
    // The pointer barely moves (still downward), but the engine's offset passes b's centre.
    a.offset = { x: 0, y: 36 }
    Reorder.dragMove(h.group, "a", { x: 0, y: 20 })
    expect(h.state.calls).toEqual([["b", "a", "c"]])
  })
})

describe("Reorder.Group, the data type (ADR-0028, decision 1)", () => {
  const options: Reorder.GroupOptions<string> = { values: () => ["a", "b"], onReorder: () => {} }

  it("a literal isn't a Group: its TypeId and pipe are required", () => {
    // @ts-expect-error TS2739: an object literal lacks `[TypeId]`, `pipe` and Inspectable's members.
    const literal: Reorder.Group<string> = {
      options,
      sources: new Map(),
      gesture: { current: Option.none() } as never,
    }
    expect(Reorder.isGroup(literal)).toBe(false)
  })

  it("isGroup: make's, not a spread", () => {
    const group = Reorder.make(options)
    expect(Reorder.isGroup(group)).toBe(true)
    expect(Reorder.isGroup({ ...group })).toBe(false)
    expect(Reorder.isGroup(options)).toBe(false)
  })

  it("each operation's two forms give one type, and pipe runs the data-last form", () => {
    const h = harness(["a", "b", "c"])
    const source = h.state.sources.get("a")!
    expectTypeOf(Reorder.register(h.group, "a", source)).toEqualTypeOf(h.group.pipe(Reorder.register("a", source)))
    expectTypeOf(Reorder.dragStart(h.group, "a")).toEqualTypeOf(h.group.pipe(Reorder.dragStart("a")))
    expectTypeOf(Reorder.dragMove(h.group, "a", { x: 0, y: 0 })).toEqualTypeOf(
      h.group.pipe(Reorder.dragMove("a", { x: 0, y: 0 })),
    )
    expectTypeOf(Reorder.dragEnd(h.group, "a")).toEqualTypeOf(h.group.pipe(Reorder.dragEnd("a")))
    expectTypeOf(Reorder.move(h.group, "a", 1)).toEqualTypeOf(h.group.pipe(Reorder.move("a", 1)))
    expectTypeOf(Reorder.resolveAxis(h.group)).toEqualTypeOf(h.group.pipe(Reorder.resolveAxis))
    // The data-last form, through pipe, on a group the checks above haven't moved: `a` to index 2.
    const fresh = harness(["a", "b", "c"])
    fresh.group.pipe(Reorder.move("a", 2))
    expect(fresh.state.calls).toEqual([["b", "c", "a"]])
  })

  it("toJSON shows how many items are registered and the value being dragged", () => {
    const h = harness(["a", "b", "c"])
    expect(h.group.toJSON()).toEqual({ _id: "Reorder.Group", registered: 3, dragging: Option.none() })
    Reorder.dragStart(h.group, "b")
    expect(h.group.toJSON()).toEqual({ _id: "Reorder.Group", registered: 3, dragging: Option.some("b") })
  })
})
