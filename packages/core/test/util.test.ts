import * as Stagger from "@wardic/core/Stagger"
import * as Velocity from "@wardic/core/Velocity"
import * as Wave from "@wardic/core/Wave"
import { expect, it } from "@effect/vitest"

it("stagger grows delay with distance from the origin", () => {
  const fromFirst = Stagger.make(0.05)
  expect(fromFirst(0, 5)).toBe(0)
  expect(fromFirst(2, 5)).toBeCloseTo(0.1, 5)

  const fromCenter = Stagger.make(0.05, { from: "center" })
  expect(fromCenter(2, 5)).toBe(0) // index 2 is the center of 5
})

it("noise is deterministic per seed and stays in [-1, 1]", () => {
  const n = Wave.noise(42)
  expect(n(1.5)).toBe(Wave.noise(42)(1.5))
  for (let x = 0; x < 20; x += 0.37) {
    const v = n(x)
    expect(v).toBeGreaterThanOrEqual(-1)
    expect(v).toBeLessThanOrEqual(1)
  }
})

it("wave and pulse sample their cycles", () => {
  expect(Wave.sine(10, 1)(0)).toBeCloseTo(0, 5)
  expect(Wave.sine(10, 1)(0.25)).toBeCloseTo(10, 5)
  expect(Wave.pulse(1)(0)).toBeCloseTo(0, 5)
  expect(Wave.pulse(1)(0.5)).toBeCloseTo(1, 5)
})

it("velocity is delta over dt", () => {
  expect(Velocity.between(0, 10, 0.5)).toBe(20)
  expect(Velocity.between(5, 5, 0)).toBe(0)
})
