// `@wardic/dom/MeasuredPair` (#430), split in #618 (A1, A3): a pair as asked for, and one its batch has
// read, a record of its own with its px; no out-parameter to fill in.
//
// - MPT1: a measured pair's px are numbers; a requested pair has none.
// - MPT2: `needs`: two ends of different length types, on a key that can be measured.
// A batch's reads are the browser's (`solid/test/measured-pairs.browser.test.tsx`, MP1–).
import * as MeasuredPair from "@wardic/dom/MeasuredPair"
import { describe, expect, expectTypeOf, it } from "vitest"

describe("MeasuredPair (#430, #618)", () => {
  it("MPT1: a measured pair's px are numbers; a requested pair has none", () => {
    expectTypeOf<MeasuredPair.Measured["fromPx"]>().toEqualTypeOf<number>()
    expectTypeOf<MeasuredPair.Measured["toPx"]>().toEqualTypeOf<number>()
    expectTypeOf<MeasuredPair.Requested>().not.toHaveProperty("fromPx")
    expectTypeOf<MeasuredPair.Requested>().not.toHaveProperty("toPx")
    expectTypeOf<MeasuredPair.Measured>().toMatchTypeOf<MeasuredPair.Requested>()
  })

  it("MPT2: needs: two ends of different length types, on a key that can be measured", () => {
    expect(MeasuredPair.needs("width", "auto", 200)).toBe(true)
    expect(MeasuredPair.needs("x", "-100%", 0)).toBe(true)
    expect(MeasuredPair.needs("width", 100, "200px"), "both px").toBe(false)
    expect(MeasuredPair.needs("opacity", 0, 1), "not a length key").toBe(false)
  })
})
