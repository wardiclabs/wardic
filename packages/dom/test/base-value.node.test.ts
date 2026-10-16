// Base values (#47, ADR-0022): the pure DOM helpers a binding feeds core's chain with. The
// `style` link's lookup (an object style or CSS text) and the coercion of a read or style
// value to the shape of the key's target. No DOM: a server could call these (it never does,
// ADR-0021). The read itself is own-values.browser.test.ts.
import * as BaseValue from "@wardic/core/BaseValue"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as OwnValues from "@wardic/dom/OwnValues"
import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"

describe("base values: the DOM's pure helpers (ADR-0022)", () => {
  it("D1: styleValueOf reads an object style by its key, then by the key dash-cased", () => {
    expect(OwnValues.styleValueOf({ opacity: 0.5 }, "opacity")).toEqual(Option.some(0.5))
    expect(OwnValues.styleValueOf({ "background-color": "red" }, "backgroundColor")).toEqual(Option.some("red"))
    expect(OwnValues.styleValueOf({ "background-color": "red" }, "background-color")).toEqual(Option.some("red"))
    expect(OwnValues.styleValueOf({ "--brandColor": "3" }, "--brandColor")).toEqual(Option.some("3"))
  })

  it("D2: styleValueOf misses on a missing key, undefined, null and an empty string", () => {
    expect(OwnValues.styleValueOf({ opacity: 0.5 }, "width")).toEqual(Option.none())
    expect(OwnValues.styleValueOf({ opacity: undefined }, "opacity")).toEqual(Option.none())
    expect(OwnValues.styleValueOf({ opacity: null }, "opacity")).toEqual(Option.none())
    expect(OwnValues.styleValueOf({ opacity: "" }, "opacity")).toEqual(Option.none())
    expect(OwnValues.styleValueOf(undefined, "opacity")).toEqual(Option.none())
  })

  it("D3: styleValueOf reads a CSS-text style, as Style.over parses it", () => {
    expect(OwnValues.styleValueOf("opacity: 0.5; background: url(a;b)", "opacity")).toEqual(Option.some("0.5"))
    expect(OwnValues.styleValueOf("opacity: 0.5; background: url(a;b)", "background")).toEqual(Option.some("url(a;b)"))
    expect(OwnValues.styleValueOf("color: red", "opacity")).toEqual(Option.none())
  })

  it("D4: valueLike, numeric target: a number, a plain-number string or a px string", () => {
    expect(OwnValues.valueLike(0.5, 1)).toEqual(Option.some(0.5))
    expect(OwnValues.valueLike("0.5", 1)).toEqual(Option.some(0.5))
    expect(OwnValues.valueLike(" 10px ", 1)).toEqual(Option.some(10))
    expect(OwnValues.valueLike(".5", 1)).toEqual(Option.some(0.5))
    expect(OwnValues.valueLike("-3.5e2px", 1)).toEqual(Option.some(-350))
    expect(OwnValues.valueLike("0", 1)).toEqual(Option.some(0))
  })

  it("D5: valueLike, numeric target: anything else misses", () => {
    for (const raw of ["auto", "50%", "1em", "rgb(0, 0, 0)", "", "none", undefined, null, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(OwnValues.valueLike(raw, 1), String(raw)).toEqual(Option.none())
    }
  })

  it("D6: valueLike, string target: a string as is, a finite number as a string, anything else misses", () => {
    expect(OwnValues.valueLike("red", "blue")).toEqual(Option.some("red"))
    expect(OwnValues.valueLike(5, "10px")).toEqual(Option.some("5"))
    expect(OwnValues.valueLike(undefined, "red")).toEqual(Option.none())
    expect(OwnValues.valueLike({}, "red")).toEqual(Option.none())
    expect(OwnValues.valueLike(Number.NaN, "red")).toEqual(Option.none())
  })

  it("D10: valueLike, string target with a unit: a length in another unit misses (the unit interpolator would die on the pair)", () => {
    expect(OwnValues.valueLike("120px", "0%")).toEqual(Option.none())
    expect(OwnValues.valueLike("0px", "-100%")).toEqual(Option.none())
    expect(OwnValues.valueLike("16px", "0.5em")).toEqual(Option.none())
    expect(OwnValues.valueLike("120px", "0px")).toEqual(Option.some("120px"))
    expect(OwnValues.valueLike("120", "0%")).toEqual(Option.some("120"))
    expect(OwnValues.valueLike("auto", "0%")).toEqual(Option.some("auto"))
    expect(OwnValues.valueLike("120px", "0")).toEqual(Option.some("120px"))
    expect(OwnValues.valueLike(5, "10px")).toEqual(Option.some("5"))
  })

  it("D7: a style value coerced to its target: the style link as the spine reads it", () => {
    expect(Option.flatMap(OwnValues.styleValueOf({ opacity: "0.5" }, "opacity"), (raw) => OwnValues.valueLike(raw, 1))).toEqual(Option.some(0.5))
    expect(Option.flatMap(OwnValues.styleValueOf("width: 120px", "width"), (raw) => OwnValues.valueLike(raw, 200))).toEqual(Option.some(120))
    expect(Option.flatMap(OwnValues.styleValueOf("width: 50%", "width"), (raw) => OwnValues.valueLike(raw, 200))).toEqual(Option.none())
  })

  it("D9: a transform key has no style link (a DOM style's `scale` is a CSS property of its own)", () => {
    expect(OwnValues.styleValueOf({ scale: "0.8", rotate: "10deg", x: 4 }, "scale")).toEqual(Option.none())
    expect(OwnValues.styleValueOf({ scale: "0.8" }, "scaleX")).toEqual(Option.none())
    expect(OwnValues.styleValueOf("scale: 0.8", "scale")).toEqual(Option.none())
    expect(OwnValues.styleValueOf({ x: 4 }, "x")).toEqual(Option.none())
  })

  it("D8: every key core gives an identity is a transform key to the DOM's project", () => {
    for (const key of Object.keys(BaseValue.TRANSFORM_IDENTITY)) {
      const patch = DomRenderer.project({ [key]: 2 })
      expect(patch[key], key).toBeUndefined()
      expect(typeof patch.transform, key).toBe("string")
    }
    expect(DomRenderer.project({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
  })
})
