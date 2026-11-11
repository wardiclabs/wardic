import type * as Box from "@wardic/core/Box"
import * as Reorder from "@wardic/core/Reorder"
import { expect, it } from "@effect/vitest"

// The Crossover (ADR-0020, grill decisions 3 and 4): Motion's `checkReorder`, ported, and its
// `detectAxis`'s answers, in linear time (#710), with the single-axis neighbour chosen by position.
// CR1-CR5 are Motion's own tests (packages/framer-motion/src/components/Reorder/utils/__tests__/
// check-reorder.test.ts at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), same boxes, same
// expectations. CR6-CR11 pin the geometric neighbour and the reference semantics; CR12 holds
// `detectAxis` to Motion's own loop, and CR13 to linear time.

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
  expect(values(Reorder.check(wrapped, "a", { offset: { x: 100, y: 100 }, velocity: { x: 1, y: 1 }, axis: "xy" }))).toEqual(["b", "c", "d", "a"])
})

// Motion check-reorder.test.ts:48-72.
it("CR3: xy waits until the dragged centre crosses a large gap", () => {
  const spaced = [wrapped[0]!, { value: "b", layout: box(200, 0, 300, 100) }]
  expect(Reorder.check(spaced, "a", { offset: { x: 100, y: 0 }, velocity: { x: 1, y: 0 }, axis: "xy" })).toBe(spaced)
  expect(values(Reorder.check(spaced, "a", { offset: { x: 101, y: 0 }, velocity: { x: 1, y: 0 }, axis: "xy" }))).toEqual(["b", "a"])
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
  expect(values(Reorder.check([...layout], "dragged", { offset: { x: 0, y: 100 }, velocity: { x: 0, y: 0 }, axis: "xy", direction: direction }))).toEqual([
    "first",
    "next",
    "dragged",
  ])
})

// Motion check-reorder.test.ts:143-158.
it("CR5: a single axis keeps its thresholds", () => {
  const horizontal = wrapped.slice(0, 2)
  expect(Reorder.check(horizontal, "a", { offset: { x: 100, y: 0 }, velocity: { x: 1, y: 0 }, axis: "y" })).toBe(horizontal)
  expect(values(Reorder.check(horizontal, "a", { offset: { x: 51, y: 0 }, velocity: { x: 1, y: 0 }, axis: "x" }))).toEqual(["b", "a"])
})

// An rtl row: the first value is the rightmost box (a 200-280, b 100-180, c 0-80).
const rtlRow: Array<Reorder.ItemData<string>> = [
  { value: "a", layout: box(200, 0, 280, 50) },
  { value: "b", layout: box(100, 0, 180, 50) },
  { value: "c", layout: box(0, 0, 80, 50) },
]

it("CR6: in an rtl row, a drag toward the neighbour on the left reorders once the item's left edge passes its centre", () => {
  // b's centre is 140; a's left edge is 200, so an offset of -60 only reaches it.
  expect(Reorder.check(rtlRow, "a", { offset: { x: -60, y: 0 }, velocity: { x: -1, y: 0 }, axis: "x" })).toBe(rtlRow)
  expect(values(Reorder.check(rtlRow, "a", { offset: { x: -61, y: 0 }, velocity: { x: -1, y: 0 }, axis: "x" }))).toEqual(["b", "a", "c"])
})

it("CR7: in an rtl row, a drag away from a neighbour reorders nothing (Motion's index rule walks b to the far end)", () => {
  // b moves right 30 px, toward a (centre 240): its right edge reaches 210, short of it.
  expect(Reorder.check(rtlRow, "b", { offset: { x: 30, y: 0 }, velocity: { x: 1, y: 0 }, axis: "x" })).toBe(rtlRow)
  // Toward a far enough, it does swap with a.
  expect(values(Reorder.check(rtlRow, "b", { offset: { x: 61, y: 0 }, velocity: { x: 1, y: 0 }, axis: "x" }))).toEqual(["b", "a", "c"])
})

it("CR8: a row-reverse row (ltr) reorders toward the neighbour on the moving side", () => {
  // flex-direction: row-reverse lays the first value out rightmost, like rtl.
  const reversed: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(180, 0, 260, 50) },
    { value: "b", layout: box(90, 0, 170, 50) },
    { value: "c", layout: box(0, 0, 80, 50) },
  ]
  // b's centre is 130: a's left edge 180 - 51 = 129 passes it.
  expect(values(Reorder.check(reversed, "a", { offset: { x: -51, y: 0 }, velocity: { x: -1, y: 0 }, axis: "x", direction: "ltr" }))).toEqual(["b", "a", "c"])
})

it("CR9: a column-reverse column reorders toward the neighbour on the moving side", () => {
  // The first value is the bottom box.
  const reversed: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(0, 120, 200, 170) },
    { value: "b", layout: box(0, 60, 200, 110) },
    { value: "c", layout: box(0, 0, 200, 50) },
  ]
  // b's centre is 85: a's top edge 120 - 36 = 84 passes it.
  expect(Reorder.check(reversed, "a", { offset: { x: 0, y: -35 }, velocity: { x: 0, y: -1 }, axis: "y" })).toBe(reversed)
  expect(values(Reorder.check(reversed, "a", { offset: { x: 0, y: -36 }, velocity: { x: 0, y: -1 }, axis: "y" }))).toEqual(["b", "a", "c"])
})

it("CR10: a zero velocity on the axis moves nothing and returns the same order", () => {
  const column: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(0, 0, 200, 50) },
    { value: "b", layout: box(0, 60, 200, 110) },
  ]
  // Far past b's centre, but with no velocity on y there is no direction.
  expect(Reorder.check(column, "a", { offset: { x: 0, y: 200 }, velocity: { x: 5, y: 0 }, axis: "y" })).toBe(column)
})

it("CR11: a value not in the order returns the same order; a move returns a new array in the new order", () => {
  const column: Array<Reorder.ItemData<string>> = [
    { value: "a", layout: box(0, 0, 200, 50) },
    { value: "b", layout: box(0, 60, 200, 110) },
    { value: "c", layout: box(0, 120, 200, 170) },
  ]
  expect(Reorder.check(column, "zz", { offset: { x: 0, y: 100 }, velocity: { x: 0, y: 1 }, axis: "y" })).toBe(column)
  // a's bottom 50 + 36 = 86 passes b's centre 85 (normal flow: the same neighbour as Motion's).
  const moved = Reorder.check(column, "a", { offset: { x: 0, y: 36 }, velocity: { x: 0, y: 1 }, axis: "y" })
  expect(moved).not.toBe(column)
  expect(values(moved)).toEqual(["b", "a", "c"])
  expect(values(column)).toEqual(["a", "b", "c"])
})

// #710: detectAxis's answers are Motion's. The reference is Motion's own loop over every pair
// (Reorder/utils/detect-axis.ts at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), a different method.
const motionDetectAxis = (layouts: ReadonlyArray<Box.Box>): Reorder.Axis => {
  const isSeparated = (a: Box.Axis, b: Box.Axis): boolean => a.max <= b.min || b.max <= a.min
  let x = false
  let y = false
  for (let i = 0; i < layouts.length; i++) {
    for (let j = i + 1; j < layouts.length; j++) {
      x ||= isSeparated(layouts[i]!.x, layouts[j]!.x)
      y ||= isSeparated(layouts[i]!.y, layouts[j]!.y)
      if (x && y) return "xy"
    }
  }
  if (x) return "x"
  return "y"
}

/** A seeded generator, so every run checks the same lists. */
const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** A list's boxes, as `[left,right|top,bottom]`: JSON would print NaN and the infinities as null. */
const shown = (list: ReadonlyArray<Box.Box>): string => list.map((b) => `[${b.x.min},${b.x.max}|${b.y.min},${b.y.max}]`).join(" ")

it("CR12: detectAxis gives Motion's answer for columns, rows, grids, overlapping, touching, empty and non-finite boxes, and 0 to 2 of them", () => {
  const random = seeded(710)
  const int = (below: number): number => Math.floor(random() * below)
  // One coordinate in ten is NaN or an infinity, as no browser measures but an Environment might.
  const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const coordinate = (finite: number): number => {
    if (random() < 0.1) return NON_FINITE[int(3)]!
    return finite
  }
  const lists: Array<ReadonlyArray<Box.Box>> = [
    [],
    [box(0, 0, 10, 10)],
    [box(0, 0, 10, 10), box(0, 0, 10, 10)],
    [box(0, 0, 10, 10), box(10, 0, 20, 10)],
    [box(0, 0, 10, 10), box(0, 10, 10, 20)],
    [box(5, 5, 5, 5), box(5, 5, 5, 5)],
    [box(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY, 10)],
    [box(Number.NaN, 0, Number.NaN, 10), box(50, 0, 50, 10), box(50, 0, 60, 10)],
    // A column, a row and a wrapping grid, each with its gaps.
    Array.from({ length: 12 }, (_, i) => box(0, i * 32, 100, i * 32 + 28)),
    Array.from({ length: 12 }, (_, i) => box(i * 32, 0, i * 32 + 28, 100)),
    Array.from({ length: 12 }, (_, i) => box((i % 4) * 32, Math.floor(i / 4) * 32, (i % 4) * 32 + 28, Math.floor(i / 4) * 32 + 28)),
  ]
  // And 4,000 lists of up to 9 boxes on a small grid, so they overlap, touch and match often.
  for (let n = 0; n < 4000; n++) {
    lists.push(
      Array.from({ length: int(10) }, () => {
        const left = int(6)
        const top = int(6)
        return box(coordinate(left), coordinate(top), coordinate(left + int(4)), coordinate(top + int(4)))
      }),
    )
  }
  for (const list of lists) expect(Reorder.detectAxis(list), shown(list)).toBe(motionDetectAxis(list))
})

// #710: a column made every pair before; 200 million at 20,000 boxes.
it("CR13: detectAxis isn't quadratic: a 20,000-box column well inside a second", () => {
  const column = Array.from({ length: 20000 }, (_, i) => box(0, i * 32, 100, i * 32 + 28))
  const started = performance.now()
  expect(Reorder.detectAxis(column)).toBe("y")
  expect(performance.now() - started).toBeLessThan(1000)
})
