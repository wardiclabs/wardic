import { complexInterpolator, InterpolatorRegistry, InterpolatorRegistryLive } from "@wardic/core"
import * as Effect from "effect/Effect"
import { expect, it, layer } from "@effect/vitest"

// Pure interpolator tests — the same-structure tier of path morphing (ADR-0015).

it("matches a multi-number string, not single-number / non-string values", () => {
  expect(complexInterpolator.match("M0,0 L10,10")).toBe(true) // 4 numbers
  expect(complexInterpolator.match("0,0 10,10")).toBe(true) // points
  expect(complexInterpolator.match("10px")).toBe(false) // single number → unit's job
  expect(complexInterpolator.match("none")).toBe(false) // no numbers
  expect(complexInterpolator.match(5)).toBe(false)
})

it("interpolates a same-structure SVG path component-wise", () => {
  expect(complexInterpolator.interpolate("M0,0 L10,10", "M0,0 L20,20", 0.5)).toBe("M0,0 L15,15")
})

it("interpolates a points list (polyline/polygon) component-wise", () => {
  expect(complexInterpolator.interpolate("0,0 10,10", "0,0 20,30", 0.5)).toBe("0,0 15,20")
})

it("handles signed + decimal numbers", () => {
  expect(complexInterpolator.interpolate("M-1.5,0", "M1.5,0", 0.5)).toBe("M0,0")
})

it("interpolates a multi-part box-shadow / filter string", () => {
  expect(complexInterpolator.interpolate("0px 0px 0px", "10px 20px 4px", 0.5)).toBe("5px 10px 2px")
})

it("snaps (discrete) when the templates differ — mismatched command structure", () => {
  // Different command (L vs C) → templates differ → cannot blend.
  expect(complexInterpolator.interpolate("M0,0 L10,10", "M0,0 C1,1 2,2 3,3", 0.5)).toBe("M0,0 L10,10")
  expect(complexInterpolator.interpolate("M0,0 L10,10", "M0,0 C1,1 2,2 3,3", 1)).toBe("M0,0 C1,1 2,2 3,3")
})

it("snaps when number counts differ even with the same leading commands", () => {
  expect(complexInterpolator.interpolate("M0,0 L10,10", "M0,0 L10,10 L20,20", 0.5)).toBe("M0,0 L10,10")
})

// Registry-backed: resolution order — `complex` only catches what the specific
// interpolators don't.
layer(InterpolatorRegistryLive)("complex interpolator routing", (it) => {
  it.effect("resolves a same-structure path pair to the complex interpolator", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      const fn = yield* registry.resolve("M0,0 L10,10", "M0,0 L20,20")
      expect(fn(0.5)).toBe("M0,0 L15,15")
    }),
  )

  it.effect("does NOT steal a single-number unit pair (`10px` stays with unit)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      const fn = yield* registry.resolve("10px", "20px")
      expect(fn(0.5)).toBe("15px")
    }),
  )

  it.effect("does NOT steal a hex color pair (complex can't match it; color blends to rgb)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      // `#000000`/`#ffffff` carry ≤1 numeric token, so complex.match is false →
      // color handles it, emitting a blended `rgb(...)` (not a discrete snap).
      const fn = yield* registry.resolve("#000000", "#ffffff")
      expect(String(fn(0.5))).toMatch(/^rgb\(/)
    }),
  )
})
