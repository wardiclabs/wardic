// Base values (#47, ADR-0022): the pure DOM helpers a binding feeds core's chain with. The
// `style` link's lookup (an object style or CSS text) and the coercion of a read or style
// value to the shape of the key's target. No DOM: a server could call these (it never does,
// ADR-0021). The read itself is own-values.browser.test.ts.
import { TRANSFORM_IDENTITY } from "@wardic/core"
import { project, styleValueOf, valueLike } from "@wardic/dom"
import { describe, expect, it } from "vitest"

describe("base values: the DOM's pure helpers (ADR-0022)", () => {
  it("D1: styleValueOf reads an object style by its key, then by the key dash-cased", () => {
    expect(styleValueOf({ opacity: 0.5 }, "opacity")).toBe(0.5)
    expect(styleValueOf({ "background-color": "red" }, "backgroundColor")).toBe("red")
    expect(styleValueOf({ "background-color": "red" }, "background-color")).toBe("red")
    expect(styleValueOf({ "--brandColor": "3" }, "--brandColor")).toBe("3")
  })

  it("D2: styleValueOf misses on a missing key, undefined, null and an empty string", () => {
    expect(styleValueOf({ opacity: 0.5 }, "width")).toBeUndefined()
    expect(styleValueOf({ opacity: undefined }, "opacity")).toBeUndefined()
    expect(styleValueOf({ opacity: null }, "opacity")).toBeUndefined()
    expect(styleValueOf({ opacity: "" }, "opacity")).toBeUndefined()
    expect(styleValueOf(undefined, "opacity")).toBeUndefined()
  })

  it("D3: styleValueOf reads a CSS-text style, as mergeStyle parses it", () => {
    expect(styleValueOf("opacity: 0.5; background: url(a;b)", "opacity")).toBe("0.5")
    expect(styleValueOf("opacity: 0.5; background: url(a;b)", "background")).toBe("url(a;b)")
    expect(styleValueOf("color: red", "opacity")).toBeUndefined()
  })

  it("D4: valueLike, numeric target: a number, a plain-number string or a px string", () => {
    expect(valueLike(0.5, 1)).toBe(0.5)
    expect(valueLike("0.5", 1)).toBe(0.5)
    expect(valueLike(" 10px ", 1)).toBe(10)
    expect(valueLike(".5", 1)).toBe(0.5)
    expect(valueLike("-3.5e2px", 1)).toBe(-350)
    expect(valueLike("0", 1)).toBe(0)
  })

  it("D5: valueLike, numeric target: anything else misses", () => {
    for (const raw of ["auto", "50%", "1em", "rgb(0, 0, 0)", "", "none", undefined, null, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(valueLike(raw, 1), String(raw)).toBeUndefined()
    }
  })

  it("D6: valueLike, string target: a string as is, a finite number as a string, anything else misses", () => {
    expect(valueLike("red", "blue")).toBe("red")
    expect(valueLike(5, "10px")).toBe("5")
    expect(valueLike(undefined, "red")).toBeUndefined()
    expect(valueLike({}, "red")).toBeUndefined()
    expect(valueLike(Number.NaN, "red")).toBeUndefined()
  })

  it("D7: a style value coerced to its target: the style link as the spine reads it", () => {
    expect(valueLike(styleValueOf({ opacity: "0.5" }, "opacity"), 1)).toBe(0.5)
    expect(valueLike(styleValueOf("width: 120px", "width"), 200)).toBe(120)
    expect(valueLike(styleValueOf("width: 50%", "width"), 200)).toBeUndefined()
  })

  it("D9: a transform key has no style link (a DOM style's `scale` is a CSS property of its own)", () => {
    expect(styleValueOf({ scale: "0.8", rotate: "10deg", x: 4 }, "scale")).toBeUndefined()
    expect(styleValueOf({ scale: "0.8" }, "scaleX")).toBeUndefined()
    expect(styleValueOf("scale: 0.8", "scale")).toBeUndefined()
    expect(styleValueOf({ x: 4 }, "x")).toBeUndefined()
  })

  it("D8: every key core gives an identity is a transform key to the DOM's project", () => {
    for (const key of Object.keys(TRANSFORM_IDENTITY)) {
      const patch = project({ [key]: 2 })
      expect(patch[key], key).toBeUndefined()
      expect(typeof patch.transform, key).toBe("string")
    }
    expect(project({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
  })
})
