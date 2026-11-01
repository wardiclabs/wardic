import * as Interpolator from "@wardic/core/Interpolator"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { describe, expect, it } from "@effect/vitest"

// Each Interpolator's `parse` and `format` (ADR-0026; plain functions since #511, where they were a
// Schema codec built on the same two, ADR-0026 *Amendment (#511)*): read once when a stream is
// built, and written per frame by the same function `format` is.

const parseUnit = Interpolator.unit.parse
const parseComplex = Interpolator.complex.parse

/** `entry`'s parse, then its format. */
const roundTrip =
  <D, E>(entry: Interpolator.Entry<D, E>) =>
  (input: unknown): E =>
    entry.format(Option.getOrThrow(entry.parse(input)))

/** Every input reads as `None`. */
const rejectsAll = (parse: (input: unknown) => Option.Option<unknown>, inputs: ReadonlyArray<unknown>) =>
  expect(Arr.map(inputs, parse)).toEqual(Arr.map(inputs, () => Option.none()))

describe("unit's parse and format", () => {
  it("reads a number with a unit, trimmed", () => {
    expect(parseUnit(" 10px ")).toEqual(Option.some({ value: 10, unit: "px" }))
    expect(parseUnit("-0.5em")).toEqual(Option.some({ value: -0.5, unit: "em" }))
    expect(parseUnit("50%")).toEqual(Option.some({ value: 50, unit: "%" }))
  })

  it("reads a bare number and a numeric string alike, with no unit", () => {
    expect(parseUnit(120)).toEqual(Option.some({ value: 120, unit: "" }))
    expect(parseUnit("120")).toEqual(Option.some({ value: 120, unit: "" }))
  })

  it("rejects what isn't a number with an optional unit, of any type", () => {
    rejectsAll(parseUnit, ["auto", "#fff", "rgb(0, 0, 0)", "10px 20px", "", [10], null, undefined, true, { value: 10, unit: "px" }])
  })

  it("round-trips through its parse and format; a bare number writes as a string", () => {
    expect(Arr.map(["10px", "-0.5em", "50%", "120"], roundTrip(Interpolator.unit))).toEqual(["10px", "-0.5em", "50%", "120"])
    expect(roundTrip(Interpolator.unit)(120)).toBe("120")
    expect(Interpolator.unit.format({ value: 2.5, unit: "px" })).toBe("2.5px")
  })
})

describe("number's and array's parse", () => {
  it("reads a number, and an array of numbers, as they are; nothing else", () => {
    expect(Interpolator.number.parse(5)).toEqual(Option.some(5))
    rejectsAll(Interpolator.number.parse, ["5", null, undefined, [5]])
    expect(Interpolator.array.parse([1, 2, 3])).toEqual(Option.some([1, 2, 3]))
    rejectsAll(Interpolator.array.parse, [[1, "2"], "1,2", 1, null])
  })
})

describe("complex's parse and format", () => {
  it("reads a string carrying numbers among other text into the parts around them and the tokens", () => {
    expect(parseComplex("M0,0 L10,10")).toEqual(Option.some({ parts: ["M", ",", " L", ",", ""], tokens: [0, 0, 10, 10] }))
    // One number inside a function is enough since #61 (Motion's rule; two or more before).
    expect(parseComplex("blur(4px)")).toEqual(Option.some({ parts: ["blur(", "px)"], tokens: [4] }))
  })

  it("names no colour: the default's tokens are numbers, so a colour's channels are numbers among its text (#160, ADR-0036)", () => {
    // The DOM's complex tier reads a colour as one token (`@wardic/dom`'s `cssComplex`).
    expect(parseComplex("0px 0px 5px rgba(0,0,0,0.5)")).toEqual(
      Option.some({ parts: ["", "px ", "px ", "px rgba(", ",", ",", ",", ")"], tokens: [0, 0, 5, 0, 0, 0, 0.5] }),
    )
  })

  it("rejects a unit string, a string with no numbers, and what isn't a string", () => {
    rejectsAll(parseComplex, ["10px", "120", "none", "auto", "", 5, ["M0,0 L1,1"], null, undefined])
  })

  it("keeps an Environment's text spans as text: the digits in them aren't numbers (#158, ADR-0035)", () => {
    // A made-up syntax, `@name`: core names no Environment's own (the DOM's `var()` is @wardic/dom's).
    const parseWith = Interpolator.complexWith({ text: [/@[\w-]+/] }).parse
    rejectsAll(parseWith, ["@shade-1", "@space-2"])
    expect(parseWith("0px 4px @shade-1")).toEqual(Option.some({ parts: ["", "px ", "px @shade-1"], tokens: [0, 4] }))
    // The default has none: there the same digits are numbers.
    expect(parseComplex("0px 4px @shade-1")).toEqual(Option.some({ parts: ["", "px ", "px @shade", ""], tokens: [0, 4, -1] }))
  })

  it("matches a text span before a number, so one that starts with a digit stays text (#158)", () => {
    const parseWith = Interpolator.complexWith({ text: [/\d+x\d+/] }).parse
    expect(parseWith("ratio 16x9 at 4px")).toEqual(Option.some({ parts: ["ratio 16x9 at ", "px"], tokens: [4] }))
  })

  it("round-trips a string whose numbers are written in their shortest form", () => {
    const inputs = ["M0,0 L10,10", "0,0 20,30", "M-1.5,0 C1,2 3,4 5,6 Z", "blur(4px) brightness(1.5)"]
    expect(Arr.map(inputs, roundTrip(Interpolator.complex))).toEqual(inputs)
  })

  it("writes numbers in their shortest form", () => {
    expect(roundTrip(Interpolator.complex)("M0.50,1e3 L.5,-0")).toBe("M0.5,1000 L0.5,0")
  })
})
