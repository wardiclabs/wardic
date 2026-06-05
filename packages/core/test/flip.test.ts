import type { Bounds } from "@wardic/core"
import { flip, FLIP_IDENTITY } from "@wardic/core"
import { expect, it } from "@effect/vitest"

/** Build a full `Bounds` from a top-left box; right/bottom/x/y derived. */
const box = (left: number, top: number, width: number, height: number): Bounds => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

it("a moved element inverts to a pure translation back to `from`", () => {
  const from = box(0, 0, 100, 100)
  const to = box(50, 20, 100, 100)
  expect(flip(from, to)).toEqual({ x: -50, y: -20, scaleX: 1, scaleY: 1 })
})

it("a resized element inverts to the size ratio", () => {
  const from = box(0, 0, 200, 100)
  const to = box(0, 0, 100, 50)
  expect(flip(from, to)).toEqual({ x: 0, y: 0, scaleX: 2, scaleY: 2 })
})

it("an unchanged box inverts to identity", () => {
  const b = box(10, 10, 100, 100)
  expect(flip(b, b)).toEqual(FLIP_IDENTITY)
})

it("guards a zero-sized `to` to scale 1 (no Infinity/NaN)", () => {
  const from = box(0, 0, 100, 100)
  const to = box(0, 0, 0, 0)
  const t = flip(from, to)
  expect(t.scaleX).toBe(1)
  expect(t.scaleY).toBe(1)
})
