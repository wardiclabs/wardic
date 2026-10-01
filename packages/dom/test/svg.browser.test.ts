// SVG attribute/style routing (ADR-0014) — unit tests for the DOM applier's
// router on REAL SVG elements (createElementNS, so `instanceof SVGElement` holds).
import { dashCase, isSvgInner, isSvgRoot, setSvgAttrs, splitPatch, splitPatchForTag } from "@wardic/dom"
import { describe, expect, it } from "vitest"

const SVGNS = "http://www.w3.org/2000/svg"
const svg = (tag: string): SVGElement => document.createElementNS(SVGNS, tag) as SVGElement

describe("splitPatch — SVG attribute/style routing (ADR-0014)", () => {
  it("HTML element: everything stays style; attrs empty (prior behavior)", () => {
    const div = document.createElement("div")
    const { style, attrs } = splitPatch(div, { transform: "translateX(5px)", opacity: 0.5 })
    expect(style).toEqual({ transform: "translateX(5px)", opacity: 0.5 })
    expect(attrs).toEqual({})
  })

  it("svg-inner: geometry/presentation keys route to attributes (dash-cased)", () => {
    const { style, attrs } = splitPatch(svg("circle"), { cx: 50, r: 20, strokeWidth: 4, fill: "rgb(0,0,255)" })
    expect(attrs).toMatchObject({ cx: "50", r: "20", "stroke-width": "4", fill: "rgb(0,0,255)" })
    expect(style).toEqual({})
  })

  it("svg-inner: transform stays style + injects fill-box + a centred origin", () => {
    const { style } = splitPatch(svg("rect"), { transform: "rotate(45deg)" })
    expect(style).toMatchObject({
      transform: "rotate(45deg)",
      "transform-box": "fill-box",
      "transform-origin": "50% 50%",
    })
  })

  it("svg-inner: a user-set transform-origin wins over the injected default", () => {
    const { style } = splitPatch(svg("rect"), { transform: "rotate(45deg)", transformOrigin: "0 0" })
    expect(style.transformOrigin).toBe("0 0")
    expect(style["transform-origin"]).toBeUndefined()
  })

  it("svg-inner: pathLength expands to a normalised stroke dash (unitless)", () => {
    const { attrs } = splitPatch(svg("path"), { pathLength: 0.5 })
    expect(attrs).toMatchObject({ pathLength: "1", "stroke-dasharray": "0.5 1", "stroke-dashoffset": "0" })
  })

  it("svg-inner: pathSpacing/pathOffset feed the dash array + offset (negated)", () => {
    const { attrs } = splitPatch(svg("path"), { pathLength: 0.3, pathSpacing: 2, pathOffset: 0.1 })
    expect(attrs["stroke-dasharray"]).toBe("0.3 2")
    expect(attrs["stroke-dashoffset"]).toBe("-0.1")
  })

  it("svg-inner: attrX/attrY/attrScale set the x/y/scale ATTRIBUTE, not the transform", () => {
    const { style, attrs } = splitPatch(svg("rect"), { attrX: 10, attrY: 20, attrScale: 2 })
    expect(attrs).toMatchObject({ x: "10", y: "20", scale: "2" })
    expect(style).toEqual({})
  })

  it("element detection: svg root is styled like HTML; inner is svg-inner", () => {
    expect(isSvgRoot(svg("svg"))).toBe(true)
    expect(isSvgInner(svg("svg"))).toBe(false)
    expect(isSvgInner(svg("circle"))).toBe(true)
    expect(isSvgInner(document.createElement("div"))).toBe(false)
    // svg root: keys stay style (viewBox-as-attr is deferred).
    expect(splitPatch(svg("svg"), { opacity: 0.5 }).attrs).toEqual({})
  })

  it("setSvgAttrs writes each attribute onto the element", () => {
    const circle = svg("circle")
    setSvgAttrs(circle, { cx: "50", "stroke-width": "3" })
    expect(circle.getAttribute("cx")).toBe("50")
    expect(circle.getAttribute("stroke-width")).toBe("3")
  })

  it("dashCase: camelCase → kebab; leaves kebab + non-alpha untouched", () => {
    expect(dashCase("strokeWidth")).toBe("stroke-width")
    expect(dashCase("transformBox")).toBe("transform-box")
    expect(dashCase("x1")).toBe("x1")
    expect(dashCase("fill")).toBe("fill")
  })
})

// A server has no element to test, so the Starting style routes by tag (ADR-0021); the
// tag's routing must be the element's.
describe("splitPatchForTag — the same routing by tag name (ADR-0021)", () => {
  it("SVG-T1: for each tag, splitPatchForTag equals splitPatch on a real element", () => {
    const patch = { cx: 10, opacity: 0.5, transform: "translateX(5px)", transformOrigin: "0 0", pathLength: 0.5, attrX: 3 }
    for (const tag of ["circle", "rect", "path", "g", "line", "ellipse", "polygon", "text", "svg"]) {
      expect(splitPatchForTag(tag, patch), tag).toEqual(splitPatch(svg(tag), patch))
    }
    for (const tag of ["div", "a"]) {
      expect(splitPatchForTag(tag, patch), tag).toEqual(splitPatch(document.createElement(tag), patch))
    }
  })
})
