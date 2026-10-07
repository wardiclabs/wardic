import { complexInterpolator, InterpolatorRegistry, InterpolatorRegistryLive, unitInterpolator } from "@wardic/core"
import * as Effect from "effect/Effect"
import { expect, it, layer } from "@effect/vitest"

// A Discrete pair (CONTEXT.md, ADR-0024 decision 3): a pair no Interpolator can blend switches to
// its target at its leg's first frame, `t > 0 ? to : from`, as Motion's `mixImmediate` does
// (motion-dom utils/mix/immediate.ts:1-3 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8). It held its
// start until t = 1 before #56.

/** A pair's blend at the start, just past it, half-way, and at the end. */
const at = (fn: (t: number) => unknown) => ({ start: fn(0), first: fn(0.01), half: fn(0.5), end: fn(1) })

it("DP1: the complex tier switches a mismatched template at the first frame past 0", () => {
  const from = "M0,0 L10,10"
  const to = "M0,0 C1,1 2,2 3,3"
  expect(at((t) => complexInterpolator.interpolate(from, to, t))).toEqual({ start: from, first: to, half: to, end: to })
})

it("DP2: the unit tier switches an unparseable pair at the first frame past 0", () => {
  expect(at((t) => unitInterpolator.interpolate("auto", "10px", t))).toEqual({
    start: "auto",
    first: "10px",
    half: "10px",
    end: "10px",
  })
})

it("DP3: a progress below 0 (an easing that dips under it) still shows the start", () => {
  expect(complexInterpolator.interpolate("M0,0 L10,10", "M0,0 C1,1 2,2 3,3", -0.1)).toBe("M0,0 L10,10")
  expect(unitInterpolator.interpolate("auto", "10px", -0.1)).toBe("auto")
})

layer(InterpolatorRegistryLive)("the registry's Discrete pairs", (it) => {
  const resolved = (from: unknown, to: unknown) =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      return at(yield* registry.resolve(from, to))
    })

  it.effect("DP4: two keywords no entry matches ('auto' → 'none') switch at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved("auto", "none")).toEqual({ start: "auto", first: "none", half: "none", end: "none" })
    }),
  )

  it.effect("DP5: a colour and a keyword ('rgb(255, 0, 0)' → 'none') switch at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved("rgb(255, 0, 0)", "none")).toEqual({
        start: "rgb(255, 0, 0)",
        first: "none",
        half: "none",
        end: "none",
      })
    }),
  )

  it.effect("DP6: an unparseable unit pair, either way round, switches at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved("auto", "50px")).toEqual({ start: "auto", first: "50px", half: "50px", end: "50px" })
      expect(yield* resolved("50%", "auto")).toEqual({ start: "50%", first: "auto", half: "auto", end: "auto" })
    }),
  )

  it.effect("DP7: a number and an unparseable string switch at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved(0, "auto")).toEqual({ start: 0, first: "auto", half: "auto", end: "auto" })
      expect(yield* resolved("auto", 0)).toEqual({ start: "auto", first: 0, half: 0, end: 0 })
    }),
  )

  it.effect("DP8: two paths of different structure switch at the first frame through the registry", () =>
    Effect.gen(function* () {
      const from = "M0,0 L10,10"
      const to = "M0,0 L10,10 L20,20"
      expect(yield* resolved(from, to)).toEqual({ start: from, first: to, half: to, end: to })
    }),
  )

  it.effect("DP9 (guard): a pair that blends still blends", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      expect((yield* registry.resolve("#000", "#fff"))(0.5)).toBe("rgb(128, 128, 128)")
      expect((yield* registry.resolve("10px", "20px"))(0.5)).toBe("15px")
    }),
  )
})
