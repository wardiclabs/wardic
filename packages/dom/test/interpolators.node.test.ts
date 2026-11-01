// The DOM Environment's Interpolators (ADR-0035, *Amendment (#158)*; ADR-0036): core's built-ins, with
// the DOM's colours, and the complex tier given CSS's `var()` as text, through
// `InterpolatorRegistryDomLive`. The colours' own tests are `colors.node.test.ts`. Since #61 the
// complex tier took a string with one or more numbers, and read the digits in a variable's name as
// numbers: `var(--gray-500)` → `var(--gray-600)` blended through `var(--gray-550)`, an undefined
// variable, so the property painted its fallback mid-leg (SK18 in solid's `string-keys.browser.test.tsx`).
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import { cssComplex } from "../src/internal/complex.ts"
import { expect, layer } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Interpolator from "@wardic/core/Interpolator"

const at = (fn: (t: number) => unknown) => ({ start: fn(0), first: fn(0.01), half: fn(0.5), end: fn(1) })

layer(DomInterpolators.layer)("the DOM's Interpolators (#158)", (it) => {
  const resolved = (from: unknown, to: unknown) =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      return at(yield* registry.resolve(from, to))
    })

  it.effect("CV1: var(--gray-500) → var(--gray-600) switches at the first frame, not through var(--gray-550)", () =>
    Effect.gen(function* () {
      expect(yield* resolved("var(--gray-500)", "var(--gray-600)")).toEqual({
        start: "var(--gray-500)",
        first: "var(--gray-600)",
        half: "var(--gray-600)",
        end: "var(--gray-600)",
      })
      expect((yield* resolved("var(--space-2)", "var(--space-4)")).half).toBe("var(--space-4)")
      expect((yield* resolved("var(--brand, var(--gray-500))", "var(--gray-600)")).half).toBe("var(--gray-600)")
    }),
  )

  it.effect("CV2: lengths blend around a var() whose name holds digits, and the target's var() is written", () =>
    Effect.gen(function* () {
      expect((yield* resolved("0px 0px 4px var(--shadow-1)", "0px 0px 8px var(--shadow-2)")).half).toBe("0px 0px 6px var(--shadow-2)")
      expect((yield* resolved("calc(var(--gap-1) * 2)", "calc(var(--gap-2) * 4)")).half).toBe("calc(var(--gap-2) * 3)")
      // A different count of var()s can't blend (Motion's mixComplex): a Discrete pair.
      expect((yield* resolved("0px 4px var(--a)", "0px 8px")).half).toBe("0px 8px")
    }),
  )

  it.effect("CV3 (guard): the other tiers are core's, in core's order, with the DOM's colours before unit (#160)", () =>
    Effect.gen(function* () {
      expect(Arr.map(Interpolator.defaults, (entry) => entry.name)).toEqual(["number", "array", "unit", "complex"])
      expect(Arr.map(DomInterpolators.all, (entry) => entry.name)).toEqual(["number", "array", "color(rgb)", "unit", "complex"])
      expect((yield* resolved("#000000", "#ffffff")).end).toBe("rgb(255, 255, 255)")
      expect((yield* resolved("10px", "20px")).half).toBe("15px")
      expect((yield* resolved("M0,0 L10,10", "M0,0 L20,20")).half).toBe("M0,0 L15,15")
    }),
  )
})

layer(DomInterpolators.layer)("the DOM's complex parse (#158)", (it) => {
  it("CV4: keeps a var() as text, and a lone var() isn't a complex value", () => {
    const decode = cssComplex.parse
    expect(decode("var(--gray-500)")).toEqual(Option.none())
    expect(decode("0px 4px var(--shadow-1)")).toEqual(Option.some({ parts: ["", "px ", "px var(--shadow-1)"], tokens: [0, 4] }))
    expect(decode("calc(var(--gap-1) * 2)")).toEqual(Option.some({ parts: ["calc(var(--gap-1) * ", ")"], tokens: [2] }))
  })
})
