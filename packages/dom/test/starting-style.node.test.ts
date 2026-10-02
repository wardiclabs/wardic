// The Starting style's helpers (ADR-0021): the framework-free half every binding uses to
// render an element before its first Frame, on a server and on the client alike.
// `toValues`, `resolveInitial` and `mergeStyle` move here from @wardic/solid's
// use-wardic.tsx with their behaviour unchanged; `startingStyle` projects with the DOM's
// pure `project` and routes an SVG element's keys by its tag (ADR-0014), since a server
// has no element to test.
//
// Expected projections come from RendererDomLive's own `project`, except where a test pins
// a routing outcome.
import { Renderer } from "@wardic/core"
import {
  dragDefaultStyle,
  isSvgInnerTag,
  mergeStyle,
  RendererDomLive,
  resolveInitial,
  splitPatchForTag,
  startingStyle,
  toValues,
} from "@wardic/dom"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"

const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer }), RendererDomLive)).project

describe("Starting style helpers (ADR-0021)", () => {
  it("ST1: toValues keeps numbers and strings (custom properties too) and drops the rest", () => {
    expect(toValues({ opacity: 0, color: "red", "--x": "1px", gone: undefined, flag: true, obj: {} })).toEqual({
      opacity: 0,
      color: "red",
      "--x": "1px",
    })
    expect(toValues(undefined)).toEqual({})
  })

  it("ST2: resolveInitial with no initial is empty", () => {
    expect(resolveInitial({})).toEqual({})
  })

  it("ST3: resolveInitial of a values map is that map, cleaned", () => {
    expect(resolveInitial({ initial: { opacity: 0, x: 10, gone: undefined } })).toEqual({ opacity: 0, x: 10 })
  })

  it("ST4: resolveInitial of a variant name is that variant's values; an unknown name is empty", () => {
    const variants = { hidden: { opacity: 0, scale: 0.5 }, shown: { opacity: 1 } }
    expect(resolveInitial({ initial: "hidden", variants })).toEqual({ opacity: 0, scale: 0.5 })
    expect(resolveInitial({ initial: "nope", variants })).toEqual({})
    expect(resolveInitial({ initial: "hidden" })).toEqual({})
  })

  it("ST5: mergeStyle with no user style returns the animated patch", () => {
    const animated = { opacity: 0 }
    expect(mergeStyle(undefined, animated)).toBe(animated)
  })

  it("ST6: mergeStyle puts the animated keys over the user's and keeps the user's others", () => {
    expect(mergeStyle({ color: "red", opacity: 0.5 }, { opacity: 0 })).toEqual({ color: "red", opacity: 0 })
  })

  it("ST7: mergeStyle layers drag defaults < base < user < animated", () => {
    const defaults = dragDefaultStyle("x")
    const merged = mergeStyle({ "touch-action": "auto", margin: "2px" }, { opacity: 0 }, defaults, { margin: "1px", padding: "3px" })
    expect(merged["touch-action"]).toBe("auto")
    expect(merged.margin).toBe("2px")
    expect(merged.padding).toBe("3px")
    expect(merged.opacity).toBe(0)
    expect(merged["user-select"]).toBe("none")
  })

  it("ST8: a user's user-select or -webkit-user-select sets the other (one property in Chromium)", () => {
    const defaults = dragDefaultStyle("x")
    expect(mergeStyle({ "user-select": "text" }, {}, defaults)["-webkit-user-select"]).toBe("text")
    expect(mergeStyle({ "-webkit-user-select": "text" }, {}, defaults)["user-select"]).toBe("text")
  })

  it("ST14: a string user style is parsed into its declarations (custom properties and parentheses kept)", () => {
    expect(mergeStyle("color: red; background: url(a;b); --x: 1px", { opacity: 0 })).toEqual({
      color: "red",
      background: "url(a;b)",
      "--x": "1px",
      opacity: 0,
    })
    expect(mergeStyle("", { opacity: 0 })).toEqual({ opacity: 0 })
    expect(mergeStyle("user-select: text", {}, dragDefaultStyle("x"))["-webkit-user-select"]).toBe("text")
  })

  it("ST9: an HTML element's Starting style is all style", () => {
    const values = { opacity: 0, x: 10 }
    expect(startingStyle("div", values)).toEqual({ style: domProject(values), attrs: {} })
    expect(startingStyle(undefined, values)).toEqual({ style: domProject(values), attrs: {} })
  })

  it("ST10: an svg-inner element's keys become attributes, its transform stays style", () => {
    const { style, attrs } = startingStyle("circle", { cx: 10, opacity: 0.5, x: 5 })
    expect(attrs).toEqual({ cx: "10", opacity: "0.5" })
    expect(String(style.transform)).toContain("translateX(5px)")
    expect(style["transform-box"]).toBe("fill-box")
    expect(style["transform-origin"]).toBe("50% 50%")
  })

  it("ST11: the svg root's Starting style is all style", () => {
    expect(startingStyle("svg", { opacity: 0 })).toEqual({ style: domProject({ opacity: 0 }), attrs: {} })
  })

  it("ST12: splitPatchForTag routes pathLength and attrX as splitPatch does", () => {
    expect(splitPatchForTag("path", { pathLength: 0.5, attrX: 3 }).attrs).toEqual({
      pathLength: "1",
      "stroke-dasharray": "0.5 1",
      "stroke-dashoffset": "0",
      x: "3",
    })
  })

  it("ST13: isSvgInnerTag knows SVG's inner elements, not the root or HTML's", () => {
    for (const tag of ["circle", "rect", "path", "g", "text", "clipPath", "linearGradient", "feGaussianBlur"]) {
      expect(isSvgInnerTag(tag), tag).toBe(true)
    }
    for (const tag of ["svg", "div", "a", "title", "span", "my-element"]) expect(isSvgInnerTag(tag), tag).toBe(false)
  })
})
