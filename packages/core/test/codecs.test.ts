import * as Interpolator from "@wardic/core/Interpolator"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "@effect/vitest"

// Each Interpolator's codec (ADR-0026): decoded once when a stream is built, and encoded per
// frame by the plain function its transformation encodes with. These run Schema's own decode
// and encode against those plain parses and formats.

const decodeUnit = Schema.decodeUnknownOption(Interpolator.UnitString)
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

describe("ComplexString", () => {
  it("decodes a string carrying numbers among other text into the parts around them and the tokens", () => {
    expect(decodeComplex("M0,0 L10,10")).toEqual(Option.some({ parts: ["M", ",", " L", ",", ""], tokens: [0, 0, 10, 10] }))
    // One number inside a function is enough since #61 (Motion's rule; two or more before).
    expect(decodeComplex("blur(4px)")).toEqual(Option.some({ parts: ["blur(", "px)"], tokens: [4] }))
  })

  it("names no colour: the default's tokens are numbers, so a colour's channels are numbers among its text (#160, ADR-0036)", () => {
    // The DOM's complex tier reads a colour as one token (`@wardic/dom`'s `cssComplex`).
    expect(decodeComplex("0px 0px 5px rgba(0,0,0,0.5)")).toEqual(
      Option.some({ parts: ["", "px ", "px ", "px rgba(", ",", ",", ",", ")"], tokens: [0, 0, 5, 0, 0, 0, 0.5] }),
    )
  })

  it("rejects a unit string, a string with no numbers, and what isn't a string", () => {
    rejectsAll(decodeComplex, ["10px", "120", "none", "auto", "", 5, ["M0,0 L1,1"]])
  })

  it("keeps an Environment's text spans as text: the digits in them aren't numbers (#158, ADR-0035)", () => {
    // A made-up syntax, `@name`: core names no Environment's own (the DOM's `var()` is @wardic/dom's).
    const decodeWith = Schema.decodeUnknownOption(Interpolator.complexStringWith({ text: [/@[\w-]+/] }))
    rejectsAll(decodeWith, ["@shade-1", "@space-2"])
    expect(decodeWith("0px 4px @shade-1")).toEqual(Option.some({ parts: ["", "px ", "px @shade-1"], tokens: [0, 4] }))
    // The default has none: there the same digits are numbers.
    expect(decodeComplex("0px 4px @shade-1")).toEqual(Option.some({ parts: ["", "px ", "px @shade", ""], tokens: [0, 4, -1] }))
  })

  it("matches a text span before a number, so one that starts with a digit stays text (#158)", () => {
    const decodeWith = Schema.decodeUnknownOption(Interpolator.complexStringWith({ text: [/\d+x\d+/] }))
    expect(decodeWith("ratio 16x9 at 4px")).toEqual(Option.some({ parts: ["ratio 16x9 at ", "px"], tokens: [4] }))
  })

  it("round-trips a string whose numbers are written in their shortest form", () => {
    const inputs = ["M0,0 L10,10", "0,0 20,30", "M-1.5,0 C1,2 3,4 5,6 Z", "blur(4px) brightness(1.5)"]
    expect(Arr.map(inputs, roundTrip(Interpolator.ComplexString))).toEqual(inputs)
  })

  it("encodes numbers in their shortest form", () => {
    expect(roundTrip(Interpolator.ComplexString)("M0.50,1e3 L.5,-0")).toBe("M0.5,1000 L0.5,0")
  })
})
