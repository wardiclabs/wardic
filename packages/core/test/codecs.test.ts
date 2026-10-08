import { ColorString, ComplexString, UnitString } from "@wardic/core"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "@effect/vitest"

// Each Interpolator's codec (ADR-0026): decoded once when a stream is built, and encoded per
// frame by the plain function its transformation encodes with. These run Schema's own decode
// and encode against those plain parses and formats.

const decodeUnit = Schema.decodeUnknownOption(UnitString)
const decodeColor = Schema.decodeUnknownOption(ColorString)
const decodeComplex = Schema.decodeUnknownOption(ComplexString)

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

  it("fails a decode with an issue naming what it expected", () => {
    expect(() => Schema.decodeUnknownSync(UnitString)("auto")).toThrow(/a number with an optional unit/)
  })

  it("round-trips through Schema's decode and encode; a bare number encodes as a string", () => {
    expect(Arr.map(["10px", "-0.5em", "50%", "120"], roundTrip(UnitString))).toEqual(["10px", "-0.5em", "50%", "120"])
    expect(roundTrip(UnitString)(120)).toBe("120")
    expect(Schema.encodeSync(UnitString)({ value: 2.5, unit: "px" })).toBe("2.5px")
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

  it("encodes as rgb() / rgba(), so a round trip canonicalises", () => {
    expect(roundTrip(ColorString)("#000")).toBe("rgb(0, 0, 0)")
    expect(roundTrip(ColorString)("rgba(0,0,0,0.5)")).toBe("rgba(0, 0, 0, 0.5)")
    expect(roundTrip(ColorString)("hsl(0 100% 50%)")).toBe("rgb(255, 0, 0)")
    expect(roundTrip(ColorString)("rebeccapurple")).toBe("rgb(102, 51, 153)")
  })

  it("is idempotent once canonical", () => {
    const inputs = ["#000", " #fff ", "rgba(10, 20, 30, 0.25)", "hsl(120 50% 50%)", "transparent", "rebeccapurple"]
    const once = Arr.map(inputs, roundTrip(ColorString))
    expect(Arr.map(once, roundTrip(ColorString))).toEqual(once)
  })
})

describe("ComplexString", () => {
  it("decodes a string carrying two or more numbers into the parts around them and the numbers", () => {
    expect(decodeComplex("M0,0 L10,10")).toEqual(
      Option.some({ parts: ["M", ",", " L", ",", ""], numbers: [0, 0, 10, 10] }),
    )
    expect(decodeComplex("0px 0px 5px rgba(0,0,0,0.5)")).toEqual(
      Option.some({ parts: ["", "px ", "px ", "px rgba(", ",", ",", ",", ")"], numbers: [0, 0, 5, 0, 0, 0, 0.5] }),
    )
  })

  it("rejects a string with fewer than two numbers, and what isn't a string", () => {
    rejectsAll(decodeComplex, ["10px", "none", "auto", "", 5, ["M0,0 L1,1"]])
  })

  it("round-trips a string whose numbers are written in their shortest form", () => {
    const inputs = ["M0,0 L10,10", "0,0 20,30", "M-1.5,0 C1,2 3,4 5,6 Z", "0px 0px 5px rgba(0,0,0,0.5)"]
    expect(Arr.map(inputs, roundTrip(ComplexString))).toEqual(inputs)
  })

  it("encodes numbers in their shortest form", () => {
    expect(roundTrip(ComplexString)("M0.50,1e3 L.5,-0")).toBe("M0.5,1000 L0.5,0")
  })
})
