import {
  cubicBezier,
  easeInOutQuad,
  easeOutCubic,
  easings,
  linear,
  springEasing,
  steps,
} from "@wardic/core"
import { expect, it } from "@effect/vitest"

it("all easings pin the endpoints", () => {
  for (const fn of Object.values(easings)) {
    expect(fn(0)).toBeCloseTo(0, 5)
    expect(fn(1)).toBeCloseTo(1, 5)
  }
})

it("linear is the identity", () => {
  expect(linear(0.42)).toBe(0.42)
})

it("easeOutCubic decelerates (past halfway at the midpoint)", () => {
  expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
})

it("easeInOutQuad is symmetric about the midpoint", () => {
  expect(easeInOutQuad(0.25) + easeInOutQuad(0.75)).toBeCloseTo(1, 5)
  expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 5)
})

it("cubicBezier matches linear control points", () => {
  const ease = cubicBezier(0, 0, 1, 1)
  expect(ease(0.5)).toBeCloseTo(0.5, 2)
})

it("steps quantizes progress", () => {
  const ease = steps(4, "end")
  expect(ease(0)).toBe(0)
  expect(ease(0.2)).toBe(0)
  expect(ease(0.3)).toBe(0.25)
  expect(ease(1)).toBe(1)
})

it("springEasing is normalized and monotone at the ends", () => {
  const ease = springEasing({ stiffness: 170, damping: 26 })
  expect(ease(0)).toBe(0)
  expect(ease(1)).toBe(1)
  expect(ease(0.5)).toBeGreaterThan(0)
})
