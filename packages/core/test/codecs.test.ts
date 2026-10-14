import * as Interpolator from "@wardic/core/Interpolator"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "@effect/vitest"

// Each Interpolator's codec (ADR-0026): decoded once when a stream is built, and encoded per
// frame by the plain function its transformation encodes with. These run Schema's own decode
// and encode against those plain parses and formats.

const decodeUnit = Schema.decodeUnknownOption(Interpolator.UnitString)
const decodeColor = Schema.decodeUnknownOption(Interpolator.ColorString)
const decodeComplex = Schema.decodeUnknownOption(Interpolator.ComplexString)

/** Schema's decode, then Schema's encode. */
const roundTrip =
  <T, E>(codec: Schema.Codec<T, E>) =>
  (input: unknown): E =>
    Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(input))

/** Every input decodes to `None`. */
const rejectsAll = (decode: (input: unknown) => Option.Option<unknown>, inputs: ReadonlyArray<unknown>) =>
  expect(Arr.map(inputs, decode)).toEqual(Arr.map(inputs, () => Option.none()))

describe("UnitString", () => {
  it("decodes a number with a unit, trimmed", () => {
    expect(decodeUnit(" 10px ")).toEqual(Option.some({ value: 10, unit: "px" }))
    expect(decodeUnit("-0.5em")).toEqual(Option.some({ value: -0.5, unit: "em" }))
    expect(decodeUnit("50%")).toEqual(Option.some({ value: 50, unit: "%" }))
  })

  it("decodes a bare number and a numeric string alike, with no unit", () => {
    expect(decodeUnit(120)).toEqual(Option.some({ value: 120, unit: "" }))
    expect(decodeUnit("120")).toEqual(Option.some({ value: 120, unit: "" }))
  })

  it("rejects what isn't a number with an optional unit", () => {
    rejectsAll(decodeUnit, ["auto", "#fff", "rgb(0, 0, 0)", "10px 20px", "", [10], null])
  })

  it("fails a decode it rejects, with Schema's bare issue (ADR-0026, decision 9)", () => {
    expect(() => Schema.decodeUnknownSync(Interpolator.UnitString)("auto")).toThrow(/Expected a valid value/)
  })

  it("round-trips through Schema's decode and encode; a bare number encodes as a string", () => {
    expect(Arr.map(["10px", "-0.5em", "50%", "120"], roundTrip(Interpolator.UnitString))).toEqual(["10px", "-0.5em", "50%", "120"])
    expect(roundTrip(Interpolator.UnitString)(120)).toBe("120")
    expect(Schema.encodeSync(Interpolator.UnitString)({ value: 2.5, unit: "px" })).toBe("2.5px")
  })
})

describe("ColorString", () => {
  it("decodes what culori parses, trimmed, in the space it's written in", () => {
    expect(Option.map(decodeColor("#000"), (color) => color.mode)).toEqual(Option.some("rgb"))
    expect(Option.map(decodeColor(" #000 "), (color) => color.mode)).toEqual(Option.some("rgb"))
    expect(Option.map(decodeColor("hsl(0 100% 50%)"), (color) => color.mode)).toEqual(Option.some("hsl"))
    expect(Option.isSome(decodeColor("rebeccapurple"))).toBe(true)
    expect(Option.isSome(decodeColor("transparent"))).toBe(true)
  })

  it("rejects keywords and strings culori can't parse, prefixed like a colour or not", () => {
    rejectsAll(decodeColor, ["auto", "none", "inherit", "10px", "#zzz", "rgb(var(--x))", 0])
  })

  it("rejects a CSS function holding a length, which culori's parse throws on (#154)", () => {
    rejectsAll(decodeColor, [
      "blur(4px)",
      "blur(0px)",
      "drop-shadow(0px 0px 4px red)",
      "translateX(10px)",
      "inset(10px)",
      "circle(10px)",
      "rgb(1px 2px 3px)",
    ])
  })

  it("encodes as rgb() / rgba(), so a round trip canonicalises", () => {
    expect(roundTrip(Interpolator.ColorString)("#000")).toBe("rgb(0, 0, 0)")
    expect(roundTrip(Interpolator.ColorString)("rgba(0,0,0,0.5)")).toBe("rgba(0, 0, 0, 0.5)")
    expect(roundTrip(Interpolator.ColorString)("hsl(0 100% 50%)")).toBe("rgb(255, 0, 0)")
    expect(roundTrip(Interpolator.ColorString)("rebeccapurple")).toBe("rgb(102, 51, 153)")
  })

  it("is idempotent once canonical", () => {
    const inputs = ["#000", " #fff ", "rgba(10, 20, 30, 0.25)", "hsl(120 50% 50%)", "transparent", "rebeccapurple"]
    const once = Arr.map(inputs, roundTrip(Interpolator.ColorString))
    expect(Arr.map(once, roundTrip(Interpolator.ColorString))).toEqual(once)
  })
})

describe("ComplexString", () => {
  it("decodes a string carrying numbers or colours among other text into the parts around them and the tokens", () => {
    expect(decodeComplex("M0,0 L10,10")).toEqual(Option.some({ parts: ["M", ",", " L", ",", ""], tokens: [0, 0, 10, 10] }))
    // One number inside a function is enough since #61 (Motion's rule; two or more before).
    expect(decodeComplex("blur(4px)")).toEqual(Option.some({ parts: ["blur(", "px)"], tokens: [4] }))
    // A colour is one token, not its channels (#61).
    expect(decodeComplex("0px 0px 5px rgba(0,0,0,0.5)")).toEqual(
      Option.some({ parts: ["", "px ", "px ", "px ", ""], tokens: [0, 0, 5, { mode: "rgb", r: 0, g: 0, b: 0, alpha: 0.5 }] }),
    )
  })

  it("rejects a unit string, a lone colour, a string with no numbers or colours, and what isn't a string", () => {
    rejectsAll(decodeComplex, ["10px", "120", "#f00", " rgb(255, 0, 0) ", "none", "auto", "", 5, ["M0,0 L1,1"]])
  })

  it("reads a var() as text: the digits in a variable's name aren't numbers (#158)", () => {
    rejectsAll(decodeComplex, ["var(--gray-500)", "var(--space-2)", "var(--brand, var(--gray-500))"])
    expect(decodeComplex("0px 4px var(--shadow-1)")).toEqual(Option.some({ parts: ["", "px ", "px var(--shadow-1)"], tokens: [0, 4] }))
    expect(decodeComplex("calc(var(--gap-1) * 2)")).toEqual(Option.some({ parts: ["calc(var(--gap-1) * ", ")"], tokens: [2] }))
  })

  it("round-trips a string whose numbers are written in their shortest form and that holds no colour", () => {
    const inputs = ["M0,0 L10,10", "0,0 20,30", "M-1.5,0 C1,2 3,4 5,6 Z", "blur(4px) brightness(1.5)"]
    expect(Arr.map(inputs, roundTrip(Interpolator.ComplexString))).toEqual(inputs)
  })

  it("encodes numbers in their shortest form, and colours as rgb() / rgba()", () => {
    expect(roundTrip(Interpolator.ComplexString)("M0.50,1e3 L.5,-0")).toBe("M0.5,1000 L0.5,0")
    expect(roundTrip(Interpolator.ComplexString)("0px 0px 5px rgba(0,0,0,0.5)")).toBe("0px 0px 5px rgba(0, 0, 0, 0.5)")
    expect(roundTrip(Interpolator.ComplexString)("0px 0px 5px #f00")).toBe("0px 0px 5px rgb(255, 0, 0)")
  })
})
