// The DOM's colour spaces (#511, ADR-0067 decision 5): read through `culori/fn`, sRGB's syntaxes from
// the start, every other CSS colour space once `Color.registerSpaces` has run (the `colors` Feature's).
// This file imports no `culori` bundle, which registers every space as it loads, so what it reads
// before the registration is what an app without the Feature reads.
// - CS1, a hex, `rgb()`, `hsl()`, the colour names and `transparent`, from the start.
// - CS2, a wide-gamut colour isn't one before the registration: the registry reads it as a complex
//   value, its numbers blended as written.
// - CS3, after it, every CSS space is a colour, blended in sRGB as any colour (ADR-0026 *Amendment
//   (#156)*), and the `color(mode)` Interpolator blends in one; registering twice changes nothing. A
//   pair the registry resolved before stays as resolved until it `forget`s.

import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Color from "@wardic/dom/Color"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import { expect, layer } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

/** Each CSS colour space beyond sRGB's syntaxes, written as CSS writes it. */
const WIDE = [
  "oklch(0.7 0.1 200)",
  "oklab(0.7 -0.05 0.1)",
  "lab(50% 40 30)",
  "lch(50% 40 30)",
  "hwb(120 10% 20%)",
  "color(display-p3 0.2 0.4 0.6)",
  "color(rec2020 0.2 0.4 0.6)",
  "color(a98-rgb 0.2 0.4 0.6)",
  "color(prophoto-rgb 0.2 0.4 0.6)",
  "color(srgb-linear 0.2 0.4 0.6)",
  "color(xyz-d50 0.2 0.4 0.6)",
  "color(xyz-d65 0.2 0.4 0.6)",
  "color(xyz 0.2 0.4 0.6)",
]

const isColor = (value: string): boolean => Option.isSome(Color.parse(value))

layer(DomInterpolators.layer)("the DOM's colour spaces, registered on demand (#511)", (it) => {
  const halfway = (from: string, to: string) =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      return (yield* registry.resolve(from, to))(0.5)
    })

  it.effect("CS1–CS3: sRGB's syntaxes from the start, every other space once registered", () =>
    Effect.gen(function* () {
      // CS1
      expect(Arr.map(["#000", "rgb(0 0 0)", "rgba(0, 0, 0, 0.5)", "hsl(0 100% 50%)", "hsla(0, 100%, 50%, 0.5)", "rebeccapurple", "transparent", "color(srgb 0.2 0.4 0.6)"], isColor)).toEqual(
        Arr.makeBy(8, () => true),
      )
      expect((yield* halfway("#000", "#fff"))).toBe("rgb(128, 128, 128)")

      // CS2
      expect(Arr.map(WIDE, isColor)).toEqual(Arr.makeBy(WIDE.length, () => false))
      expect(yield* halfway("oklch(0.5 0.1 200)", "oklch(0.7 0.3 100)")).toBe("oklch(0.6 0.2 150)")

      // CS3
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const cached = yield* registry.resolve("oklch(0.5 0.1 200)", "oklch(0.7 0.3 100)")
      Color.registerSpaces()
      // A pair resolved before stays as it was until the registry forgets it (the `colors` Feature's).
      expect(yield* registry.resolve("oklch(0.5 0.1 200)", "oklch(0.7 0.3 100)")).toBe(cached)
      yield* registry.forget
      expect((yield* registry.resolve("oklch(0.5 0.1 200)", "oklch(0.7 0.3 100)"))(0.5)).toMatch(/^rgb\(/)
      Color.registerSpaces()
      expect(Arr.map(WIDE, isColor)).toEqual(Arr.makeBy(WIDE.length, () => true))
      expect(yield* halfway("color(display-p3 1 0 0)", "color(display-p3 0 0 1)")).toMatch(/^rgb\(/)
      expect(yield* halfway("oklch(0.5 0.1 200)", "#fff")).toMatch(/^rgb\(/)
      const blend = Option.getOrThrow(Color.interpolator("oklch").blend(Option.getOrThrow(Color.parse("#ff0000")), Option.getOrThrow(Color.parse("#0000ff"))))
      expect(blend(0.5)).toMatch(/^rgb\(/)
      expect(blend(0.5)).not.toBe(Option.getOrThrow(Color.css.blend(Option.getOrThrow(Color.parse("#ff0000")), Option.getOrThrow(Color.parse("#0000ff"))))(0.5))
    }),
  )
})

