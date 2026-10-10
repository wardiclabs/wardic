import * as Point from "@wardic/core/Point"
import * as Scalar from "@wardic/core/Scalar"
import { expect, it } from "@effect/vitest"

it("lerp / inverseLerp are inverses", () => {
  expect(Scalar.lerp(0, 100, 0.25)).toBe(25)
  expect(Scalar.inverseLerp(0, 100, 25)).toBe(0.25)
  expect(Scalar.inverseLerp(5, 5, 5)).toBe(0) // degenerate range
})

it("clamp bounds the value", () => {
  expect(Scalar.clamp(-1, 0, 10)).toBe(0)
  expect(Scalar.clamp(11, 0, 10)).toBe(10)
  expect(Scalar.clamp(5, 0, 10)).toBe(5)
})

it("wrap cycles into [min, max)", () => {
  expect(Scalar.wrap(7, 0, 5)).toBe(2)
  expect(Scalar.wrap(-1, 0, 5)).toBe(4)
  expect(Scalar.wrap(5, 0, 5)).toBe(0)
})

it("remap moves between ranges", () => {
  expect(Scalar.remap(5, 0, 10, 0, 100)).toBe(50)
})

it("damp approaches the target and is frame-rate aware", () => {
  expect(Scalar.damp(0, 10, 5, 0)).toBe(0) // no time elapsed
  const once = Scalar.damp(0, 10, 5, 1 / 60)
  expect(once).toBeGreaterThan(0)
  expect(once).toBeLessThan(10)
})

it("snap / snapTo", () => {
  expect(Scalar.snap(7, 5)).toBe(5)
  expect(Scalar.snap(8, 5)).toBe(10)
  expect(Scalar.snapTo(7, [0, 5, 10])).toBe(5)
  expect(Scalar.snapTo(9, [0, 5, 10])).toBe(10)
})

it("point helpers", () => {
  expect(Point.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  expect(Point.angle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0)
  expect(Point.lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 })
})
