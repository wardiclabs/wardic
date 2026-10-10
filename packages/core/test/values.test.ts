import * as Values from "@wardic/core/Values"
import { describe, expect, expectTypeOf, it } from "@effect/vitest"

/** `Values.split` and `Values.pick` (ADR-0028, decision 12): solid's spine and presence call them when a leg is built. */
describe("Values.split", () => {
  it("numbers only", () => {
    expect(Values.split({ x: 1, opacity: 0.5 })).toEqual({ numbers: { x: 1, opacity: 0.5 }, strings: {} })
  })

  it("strings only", () => {
    expect(Values.split({ color: "#fff", width: "10px" })).toEqual({ numbers: {}, strings: { color: "#fff", width: "10px" } })
  })

  it("a mix keeps each key with its kind", () => {
    expect(Values.split({ x: 0, color: "red", scale: 1.2, display: "none" })).toEqual({
      numbers: { x: 0, scale: 1.2 },
      strings: { color: "red", display: "none" },
    })
  })

  it("an empty map", () => {
    expect(Values.split({})).toEqual({ numbers: {}, strings: {} })
  })

  it("a key with no value at run time is in neither", () => {
    const values = { x: 1, color: undefined } as unknown as Values.Values
    expect(Values.split(values)).toEqual({ numbers: { x: 1 }, strings: {} })
  })
})

describe("Values.pick", () => {
  it("the keys of keysFrom, read out of self", () => {
    expect(Values.pick({ x: 1, color: "red", width: "10px" }, { color: "blue", width: "20px" })).toEqual({
      color: "red",
      width: "10px",
    })
  })

  it("a key missing from self, or holding undefined, is skipped", () => {
    const self = { color: "red", width: undefined } as unknown as Values.Values
    expect(Values.pick(self, { color: "blue", width: "20px", height: "5px" })).toEqual({ color: "red" })
  })

  it("an empty keysFrom picks nothing", () => {
    expect(Values.pick({ x: 1 }, {})).toEqual({})
  })

  it("both forms give one result and one type", () => {
    const self: Values.Values = { x: 1, color: "red" }
    const keysFrom: Values.Values = { color: "blue" }
    expect(Values.pick(keysFrom)(self)).toEqual(Values.pick(self, keysFrom))
    expectTypeOf(Values.pick(self, keysFrom)).toEqualTypeOf(Values.pick(keysFrom)(self))
    expectTypeOf(Values.pick(self, keysFrom)).toEqualTypeOf<Values.Values>()
  })
})
