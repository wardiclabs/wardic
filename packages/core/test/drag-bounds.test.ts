import * as Drag from "@wardic/core/Drag"
import { describe, expect, it } from "@effect/vitest"

// An element constraint's bounds (#273, ADR-0047): Motion's `calcViewportConstraints`, `calcOrigin`
// and `scalePositionWithinConstraints`.
//
// - DB1: the bounds that keep a box inside its container, per axis.
// - DB2: a box bigger than its container on an axis: the bounds swap, so it can show what overflows.
// - DB3: sameBounds, edge by edge, an absent axis or edge included.
// - DB4: progressWithin: 0 at min, 1 at max, clamped; ½ for no length.
// - DB5: keepPlace: the same place in the new bounds, on the axes the drag moves, where both have both edges.

const box = (left: number, top: number, width: number, height: number): Drag.Edges => ({ left, top, right: left + width, bottom: top + height })

describe("an element constraint's bounds (#273)", () => {
  it("DB1: the bounds that keep a box inside its container", () => {
    // A 60x60 box at (110, 120) in a 300x200 container at (100, 100).
    expect(Drag.boundsWithin(box(110, 120, 60, 60), box(100, 100, 300, 200))).toEqual({ x: { min: -10, max: 230 }, y: { min: -20, max: 120 } })
  })

  it("DB2: a box bigger than its container on an axis swaps them: dragged to show what overflows, and no further", () => {
    // A 300 px wide image at the left of a 200 px frame: x from -100 (its right at the frame's) to 0.
    expect(Drag.boundsWithin(box(100, 100, 300, 50), box(100, 100, 200, 200)).x).toEqual({ min: -100, max: 0 })
  })

  it("DB3: sameBounds, edge by edge", () => {
    expect(Drag.sameBounds({ x: { min: 0, max: 10 } }, { x: { min: 0, max: 10 } })).toBe(true)
    expect(Drag.sameBounds({ x: { min: 0, max: 10 } }, { x: { min: 0, max: 11 } })).toBe(false)
    expect(Drag.sameBounds({ x: { min: 0 } }, { x: { min: 0, max: 10 } })).toBe(false)
    expect(Drag.sameBounds({ x: { min: 0, max: 10 } }, { x: { min: 0, max: 10 }, y: { min: 0, max: 0 } })).toBe(false)
    expect(Drag.sameBounds({}, {})).toBe(true)
  })

  it("DB4: progressWithin: 0 at min, 1 at max, clamped; ½ for no length", () => {
    expect(Drag.progressWithin(25, 0, 100)).toBe(0.25)
    expect(Drag.progressWithin(-50, 0, 100)).toBe(0)
    expect(Drag.progressWithin(150, 0, 100)).toBe(1)
    expect(Drag.progressWithin(7, 5, 5)).toBe(0.5)
    // Swapped bounds (a box bigger than its container): still from min to max.
    expect(Drag.progressWithin(-75, 0, -100)).toBe(0.75)
  })

  it("DB5: keepPlace: the same place in the new bounds, on the axes the drag moves, where both have both edges", () => {
    const from: Drag.Bounds = { x: { min: 0, max: 200 }, y: { min: 0, max: 100 } }
    const to: Drag.Bounds = { x: { min: 0, max: 100 }, y: { min: 0, max: 50 } }
    expect(Drag.keepPlace({ x: 150, y: 100 }, "xy", from, to)).toEqual({ x: 75, y: 50 })
    expect(Drag.keepPlace({ x: 150, y: 100 }, "x", from, to), "y isn't moved").toEqual({ x: 75, y: 100 })
    expect(Drag.keepPlace({ x: 150, y: 100 }, "xy", { x: { min: 0 } }, to), "an open edge: stays").toEqual({ x: 150, y: 100 })
  })
})
