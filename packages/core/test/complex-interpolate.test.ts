import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { expect, it, layer } from "@effect/vitest"

// Pure interpolator tests — the same-structure tier of path morphing (ADR-0015). The entry is a
// codec and a blend (ADR-0026): `decodes` asks `ComplexString`, and `blendOf` decodes both
// endpoints once, then blends.

const decode = Schema.decodeUnknownOption(Interpolator.complex.codec)

/** Whether a value is a complex value: whether the entry's codec decodes it. */
const decodes = (value: unknown): boolean => Option.isSome(decode(value))

/** The entry's blend of two complex values: `None` when they can't blend. */
const blendOf = (from: string, to: string): Option.Option<(t: number) => string> =>
  Option.flatMap(Option.all([decode(from), decode(to)] as const), ([a, b]) => Interpolator.complex.blend(a, b))

/** The blend of two complex values that blend, at `t`. */
const at = (from: string, to: string, t: number): string => Option.getOrThrow(blendOf(from, to))(t)

it("decodes a multi-number string, not single-number / non-string values", () => {
  expect(decodes("M0,0 L10,10")).toBe(true) // 4 numbers
  expect(decodes("0,0 10,10")).toBe(true) // points
  expect(decodes("10px")).toBe(false) // single number → unit's job
  expect(decodes("none")).toBe(false) // no numbers
  expect(decodes(5)).toBe(false)
})

it("interpolates a same-structure SVG path component-wise", () => {
  expect(at("M0,0 L10,10", "M0,0 L20,20", 0.5)).toBe("M0,0 L15,15")
})

it("interpolates a points list (polyline/polygon) component-wise", () => {
  expect(at("0,0 10,10", "0,0 20,30", 0.5)).toBe("0,0 15,20")
})

it("handles signed + decimal numbers", () => {
  expect(at("M-1.5,0", "M1.5,0", 0.5)).toBe("M0,0")
})

it("interpolates a multi-part box-shadow / filter string", () => {
  expect(at("0px 0px 0px", "10px 20px 4px", 0.5)).toBe("5px 10px 2px")
})

it("can't blend two templates — mismatched command structure — so the pair is Discrete", () => {
  // Different command (L vs C) → different structure → `None`: a Discrete pair, which `resolve`
  // switches at the first frame (ADR-0024; DP1 and DP8 in discrete-pair.test.ts).
  expect(blendOf("M0,0 L10,10", "M0,0 C1,1 2,2 3,3")).toEqual(Option.none())
})

it("can't blend two number counts, even with the same leading commands", () => {
  expect(blendOf("M0,0 L10,10", "M0,0 L10,10 L20,20")).toEqual(Option.none())
})

it("decodes one number inside a function, and colours as tokens, but not a lone colour (#61)", () => {
  expect(decodes("blur(4px)")).toBe(true)
  expect(decodes("translateX(10px)")).toBe(true)
  expect(decodes("0px 0px 10px rgb(255, 0, 0)")).toBe(true)
  expect(decodes("#f00")).toBe(false) // a lone colour → color's job
  expect(decodes("120")).toBe(false) // a bare number string → unit's job
})

it("blends a shadow's colour as a colour, in sRGB as the colour tier does (#61)", () => {
  expect(at("0px 0px 10px rgb(255, 0, 0)", "0px 0px 20px rgb(0, 0, 255)", 0.5)).toBe("0px 0px 15px rgb(128, 0, 128)")
  expect(at("0px 0px 0px rgba(255, 0, 0, 0)", "0px 0px 10px rgb(255, 0, 0)", 0.5)).toBe("0px 0px 5px rgba(255, 0, 0, 0.5)")
  // A hex and an rgb() are both colours, so they match.
  expect(at("0px 0px 10px #f00", "0px 0px 20px rgb(0, 0, 255)", 0.5)).toBe("0px 0px 15px rgb(128, 0, 128)")
})

it("matches kind by kind, in order, written in the target's structure (#61, Motion's mixComplex)", () => {
  // A computed shadow (colour first, a spread) into an authored one: the start's extra number is dropped.
  expect(at("rgba(0, 0, 0, 0.2) 0px 1px 2px 0px", "0px 8px 24px rgba(0, 0, 0, 0.3)", 0.5)).toBe("0px 4.5px 13px rgba(0, 0, 0, 0.25)")
  // Fewer numbers in the start than the target: Motion's rule can't blend it (the shadow rule pads it, in Machine).
  expect(blendOf("0px 8px 24px rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.2) 0px 1px 2px 0px")).toEqual(Option.none())
  // A different count of colours can't blend.
  expect(blendOf("0px 0px 10px rgb(255, 0, 0)", "0px 0px 10px rgb(255, 0, 0), 0px 0px 4px rgb(0, 0, 0)")).toEqual(Option.none())
  // A named colour isn't a token: it's text, and the target's text is written.
  expect(at("0px 0px 10px red", "0px 0px 20px blue", 0.5)).toBe("0px 0px 15px blue")
})

// Registry-backed: resolution order — `complex` only catches what the specific
// interpolators don't.
layer(InterpolatorRegistry.layer)("complex interpolator routing", (it) => {
  it.effect("resolves a same-structure path pair to the complex interpolator", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("M0,0 L10,10", "M0,0 L20,20")
      expect(fn(0.5)).toBe("M0,0 L15,15")
    }),
  )

  it.effect("does NOT steal a single-number unit pair (`10px` stays with unit)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("10px", "20px")
      expect(fn(0.5)).toBe("15px")
    }),
  )

  it.effect("does NOT steal a hex color pair (complex can't decode it; color blends to rgb)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      // `#000000`/`#ffffff` carry ≤1 numeric token, so complex doesn't decode them →
      // color handles it, emitting a blended `rgb(...)` (not a discrete snap).
      const fn = yield* registry.resolve("#000000", "#ffffff")
      expect(String(fn(0.5))).toMatch(/^rgb\(/)
    }),
  )

  it.effect("blends a drop-shadow, a two-function filter and a two-length clip path, where culori's parse threw at resolve (#154)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const shadow = yield* registry.resolve("drop-shadow(0px 0px 4px red)", "drop-shadow(0px 0px 8px red)")
      expect(shadow(0.5)).toBe("drop-shadow(0px 0px 6px red)")
      const filter = yield* registry.resolve("blur(2px) brightness(1.5)", "blur(4px) brightness(2)")
      expect(filter(0.5)).toBe("blur(3px) brightness(1.75)")
      const inset = yield* registry.resolve("inset(10px 20px)", "inset(20px 40px)")
      expect(inset(0.5)).toBe("inset(15px 30px)")
    }),
  )

  it.effect("switches two templates at the first frame through the registry", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("M0,0 L10,10", "M0,0 C1,1 2,2 3,3")
      expect([fn(0), fn(0.5), fn(1)]).toEqual(["M0,0 L10,10", "M0,0 C1,1 2,2 3,3", "M0,0 C1,1 2,2 3,3"])
    }),
  )
})
