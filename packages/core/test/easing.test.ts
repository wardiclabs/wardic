import * as Easing from "@wardic/core/Easing"
import { expect, it } from "@effect/vitest"

/** The Penner easings: every `Easing` export but the generators (`cubicBezier`, `steps`, `spring`). */
const penner = Object.entries(Easing)
  .filter(([name]) => name === "linear" || name.startsWith("ease"))
  .map(([, fn]) => fn as Easing.Easing)

it("all easings pin the endpoints", () => {
  expect(penner).toHaveLength(31)
  for (const fn of penner) {
    expect(fn(0)).toBeCloseTo(0, 5)
    expect(fn(1)).toBeCloseTo(1, 5)
  }
})

it("linear is the identity", () => {
  expect(Easing.linear(0.42)).toBe(0.42)
})

it("easeOutCubic decelerates (past halfway at the midpoint)", () => {
  expect(Easing.easeOutCubic(0.5)).toBeGreaterThan(0.5)
})

it("easeInOutQuad is symmetric about the midpoint", () => {
  expect(Easing.easeInOutQuad(0.25) + Easing.easeInOutQuad(0.75)).toBeCloseTo(1, 5)
  expect(Easing.easeInOutQuad(0.5)).toBeCloseTo(0.5, 5)
})

it("cubicBezier matches linear control points", () => {
  const ease = Easing.cubicBezier(0, 0, 1, 1)
  expect(ease(0.5)).toBeCloseTo(0.5, 2)
})

it("steps quantizes progress", () => {
  const ease = Easing.steps(4, "end")
  expect(ease(0)).toBe(0)
  expect(ease(0.2)).toBe(0)
  expect(ease(0.3)).toBe(0.25)
  expect(ease(1)).toBe(1)
})

it("springEasing is normalized and monotone at the ends", () => {
  const ease = Easing.spring({ stiffness: 170, damping: 26 })
  expect(ease(0)).toBe(0)
  expect(ease(1)).toBe(1)
  expect(ease(0.5)).toBeGreaterThan(0)
})

it("springEasing's curve is the same since its bag is decoded (#225): main's samples at b429963", () => {
  const defaults = Easing.spring()
  expect([0.1, 0.25, 0.5, 0.75].map(defaults)).toEqual([0.47106338743795767, 0.8971595320988142, 0.9951913745458054, 0.9997920031627241])
  const bouncy = Easing.spring({ stiffness: 300, damping: 10, mass: 2 })
  expect([0.1, 0.25, 0.5, 0.75].map(bouncy)).toEqual([1.194085310278693, 1.0194798369298201, 1.0099502090092494, 0.999782822567119])
})
