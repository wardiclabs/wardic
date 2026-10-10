import type * as Box from "@wardic/core/Box"
import * as Reorder from "@wardic/core/Reorder"
import { expect, it } from "@effect/vitest"

// The Crossover (ADR-0020, grill decisions 3 and 4): Motion's `checkReorder` and
// `detectAxis`, ported, with the single-axis neighbour chosen by position. CR1-CR5 are
// Motion's own tests (packages/framer-motion/src/components/Reorder/utils/__tests__/
// check-reorder.test.ts at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), same boxes, same
// expectations. CR6-CR11 pin the geometric neighbour and the reference semantics.

/** Build a Box from its edges (left/top/right/bottom). */
const box = (left: number, top: number, right: number, bottom: number): Box.Box => ({
  x: { min: left, max: right },
  y: { min: top, max: bottom },
})

const values = (order: ReadonlyArray<Reorder.ItemData<string>>): Array<string> => order.map(({ value }) => value)

// Motion's `wrapped` fixture (check-reorder.test.ts:5-25): a 2x2 grid of 100 px cells.
const wrapped: Array<Reorder.ItemData<string>> = [
  { value: "a", layout: box(0, 0, 100, 100) },
  { value: "b", layout: box(100, 0, 200, 100) },
  { value: "c", layout: box(0, 100, 100, 200) },
  { value: "d", layout: box(100, 100, 200, 200) },
]

// Motion check-reorder.test.ts:28-34.
it("CR1: detectAxis finds horizontal, vertical, and wrapped layouts", () => {
  expect(Reorder.detectAxis(wrapped.slice(0, 2).map(({ layout }) => layout))).toBe("x")
  expect(Reorder.detectAxis([wrapped[0]!.layout, wrapped[2]!.layout])).toBe("y")
  expect(Reorder.detectAxis(wrapped.map(({ layout }) => layout))).toBe("xy")
})

// Motion check-reorder.test.ts:36-46.
it("CR2: xy moves into a wrapped row", () => {
  expect(values(Reorder.check(wrapped, "a", { x: 100, y: 100 }, { x: 1, y: 1 }, "xy"))).toEqual(["b", "c", "d", "a"])
})

// Motion check-reorder.test.ts:48-72.
it("CR3: xy waits until the dragged centre crosses a large gap", () => {
  const spaced = [wrapped[0]!, { value: "b", layout: box(200, 0, 300, 100) }]
  expect(Reorder.check(spaced, "a", { x: 100, y: 0 }, { x: 1, y: 0 }, "xy")).toBe(spaced)
  expect(values(Reorder.check(spaced, "a", { x: 101, y: 0 }, { x: 1, y: 0 }, "xy"))).toEqual(["b", "a"])
})

// Motion check-reorder.test.ts:74-141 (a test.each over ltr and rtl).
it.each([
  [
    "ltr",
    [
      { value: "first", layout: box(0, 0, 80, 80) },
      { value: "dragged", layout: box(100, 0, 180, 80) },
      { value: "next", layout: box(0, 100, 80, 180) },
    ],
  ],
  [
    "rtl",
    [
      { value: "first", layout: box(100, 0, 180, 80) },
      { value: "dragged", layout: box(0, 0, 80, 80) },
      { value: "next", layout: box(100, 100, 180, 180) },
    ],
  ],
] as const)("CR4: xy inserts into the empty end of a wrapped %s row", (direction, layout) => {
  expect(values(Reorder.check([...layout], "dragged", { x: 0, y: 100 }, { x: 0, y: 0 }, "xy", direction))).toEqual([
    "first",
    "next",
    "dragged",
  ])
})

// Motion check-reorder.test.ts:143-158.
it("CR5: a single axis keeps its thresholds", () => {
  const horizontal = wrapped.slice(0, 2)
  expect(Reorder.check(horizontal, "a", { x: 100, y: 0 }, { x: 1, y: 0 }, "y")).toBe(horizontal)
  expect(values(Reorder.check(horizontal, "a", { x: 51, y: 0 }, { x: 1, y: 0 }, "x"))).toEqual(["b", "a"])
})

// An rtl row: the first value is the rightmost box (a 200-280, b 100-180, c 0-80).
const rtlRow: Array<Reorder.ItemData<string>> = [
  { value: "a", layout: box(200, 0, 280, 50) },
  { value: "b", layout: box(100, 0, 180, 50) },
  { value: "c", layout: box(0, 0, 80, 50) },
]

it("CR6: in an rtl row, a drag toward the neighbour on the left reorders once the item's left edge passes its centre", () => {
  // b's centre is 140; a's left edge is 200, so an offset of -60 only reaches it.
  expect(Reorder.check(rtlRow, "a", { x: -60, y: 0 }, { x: -1, y: 0 }, "x")).toBe(rtlRow)
  expect(values(Reorder.check(rtlRow, "a", { x: -61, y: 0 }, { x: -1, y: 0 }, "x"))).toEqual(["b", "a", "c"])
})

it("CR7: in an rtl row, a drag away from a neighbour reorders nothing (Motion's index rule walks b to the far end)", () => {
  // b moves right 30 px, toward a (centre 240): its right edge reaches 210, short of it.
  expect(Reorder.check(rtlRow, "b", { x: 30, y: 0 }, { x: 1, y: 0 }, "x")).toBe(rtlRow)
  // Toward a far enough, it does swap with a.
  expect(values(Reorder.check(rtlRow, "b", { x: 61, y: 0 }, { x: 1, y: 0 }, "x"))).toEqual(["b", "a", "c"])
})

it("CR8: a row-reverse row (ltr) reorders toward the neighbour on the moving side", () => {
  // flex-direction: row-reverse lays the first value out rightmost, like rtl.
  const reversed: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(180, 0, 260, 50) },
    { value: "b", layout: box(90, 0, 170, 50) },
    { value: "c", layout: box(0, 0, 80, 50) },
  ]
  // b's centre is 130: a's left edge 180 - 51 = 129 passes it.
  expect(values(Reorder.check(reversed, "a", { x: -51, y: 0 }, { x: -1, y: 0 }, "x", "ltr"))).toEqual(["b", "a", "c"])
})

it("CR9: a column-reverse column reorders toward the neighbour on the moving side", () => {
  // The first value is the bottom box.
  const reversed: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(0, 120, 200, 170) },
    { value: "b", layout: box(0, 60, 200, 110) },
    { value: "c", layout: box(0, 0, 200, 50) },
  ]
  // b's centre is 85: a's top edge 120 - 36 = 84 passes it.
  expect(Reorder.check(reversed, "a", { x: 0, y: -35 }, { x: 0, y: -1 }, "y")).toBe(reversed)
  expect(values(Reorder.check(reversed, "a", { x: 0, y: -36 }, { x: 0, y: -1 }, "y"))).toEqual(["b", "a", "c"])
})

it("CR10: a zero velocity on the axis moves nothing and returns the same order", () => {
  const column: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(0, 0, 200, 50) },
    { value: "b", layout: box(0, 60, 200, 110) },
  ]
  // Far past b's centre, but with no velocity on y there is no direction.
  expect(Reorder.check(column, "a", { x: 0, y: 200 }, { x: 5, y: 0 }, "y")).toBe(column)
})

it("CR11: a value not in the order returns the same order; a move returns a new array in the new order", () => {
  const column: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(0, 0, 200, 50) },
    { value: "b", layout: box(0, 60, 200, 110) },
    { value: "c", layout: box(0, 120, 200, 170) },
  ]
  expect(Reorder.check(column, "zz", { x: 0, y: 100 }, { x: 0, y: 1 }, "y")).toBe(column)
  // a's bottom 50 + 36 = 86 passes b's centre 85 (normal flow: the same neighbour as Motion's).
  const moved = Reorder.check(column, "a", { x: 0, y: 36 }, { x: 0, y: 1 }, "y")
  expect(moved).not.toBe(column)
  expect(values(moved)).toEqual(["b", "a", "c"])
  expect(values(column)).toEqual(["a", "b", "c"])
})
