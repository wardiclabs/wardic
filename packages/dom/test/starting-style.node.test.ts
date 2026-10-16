// The Starting style's helpers (ADR-0021): the framework-free half every binding uses to
// render an element before its first Frame, on a server and on the client alike.
// `toValues`, `resolveInitial` and `mergeStyle` move here from @wardic/solid's
// use-wardic.tsx with their behaviour unchanged; `startingStyle` projects with the DOM's
// pure `project` and routes an SVG element's keys by its tag (ADR-0014), since a server
// has no element to test.
//
// Expected projections come from RendererDomLive's own `project`, except where a test pins
// a routing outcome.
import * as Renderer from "@wardic/core/Renderer"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"

const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

describe("Starting style helpers (ADR-0021)", () => {
  it("ST1: toValues keeps numbers and strings (custom properties too) and drops the rest", () => {
    expect(Style.toValues({ opacity: 0, color: "red", "--x": "1px", gone: undefined, flag: true, obj: {} })).toEqual({
      opacity: 0,
      color: "red",
      "--x": "1px",
    })
    expect(Style.toValues(undefined)).toEqual({})
  })

  it("ST2: resolveInitial with no initial is empty", () => {
    expect(Style.resolveInitial({})).toEqual({})
  })

  it("ST3: resolveInitial of a values map is that map, cleaned", () => {
    expect(Style.resolveInitial({ initial: { opacity: 0, x: 10, gone: undefined } })).toEqual({ opacity: 0, x: 10 })
  })

  it("ST4: resolveInitial of a variant name is that variant's values; an unknown name is empty", () => {
    const variants = { hidden: { opacity: 0, scale: 0.5 }, shown: { opacity: 1 } }
    expect(Style.resolveInitial({ initial: "hidden", variants })).toEqual({ opacity: 0, scale: 0.5 })
    expect(Style.resolveInitial({ initial: "nope", variants })).toEqual({})
    expect(Style.resolveInitial({ initial: "hidden" })).toEqual({})
  })

  it("ST5: mergeStyle with no user style returns the animated patch", () => {
    const animated = { opacity: 0 }
    expect(Style.merge(undefined, animated)).toBe(animated)
  })

  it("ST6: mergeStyle puts the animated keys over the user's and keeps the user's others", () => {
    expect(Style.merge({ color: "red", opacity: 0.5 }, { opacity: 0 })).toEqual({ color: "red", opacity: 0 })
  })

  it("ST7: mergeStyle layers drag defaults < base < user < animated", () => {
    const defaults = Style.dragDefaults("x")
    const merged = Style.merge({ "touch-action": "auto", margin: "2px" }, { opacity: 0 }, defaults, { margin: "1px", padding: "3px" })
    expect(merged["touch-action"]).toBe("auto")
    expect(merged.margin).toBe("2px")
    expect(merged.padding).toBe("3px")
    expect(merged.opacity).toBe(0)
    expect(merged["user-select"]).toBe("none")
  })

  it("ST8: a user's user-select or -webkit-user-select sets the other (one property in Chromium)", () => {
    const defaults = Style.dragDefaults("x")
    expect(Style.merge({ "user-select": "text" }, {}, defaults)["-webkit-user-select"]).toBe("text")
    expect(Style.merge({ "-webkit-user-select": "text" }, {}, defaults)["user-select"]).toBe("text")
  })

  it("ST14: a string user style is parsed into its declarations (custom properties and parentheses kept)", () => {
    expect(Style.merge("color: red; background: url(a;b); --x: 1px", { opacity: 0 })).toEqual({
      color: "red",
      background: "url(a;b)",
      "--x": "1px",
      opacity: 0,
    })
    expect(Style.merge("", { opacity: 0 })).toEqual({ opacity: 0 })
    expect(Style.merge("user-select: text", {}, Style.dragDefaults("x"))["-webkit-user-select"]).toBe("text")
  })

  it("ST9: an HTML element's Starting style is all style", () => {
    const values = { opacity: 0, x: 10 }
    expect(Style.starting("div", values)).toEqual({ style: domProject(values), attrs: {} })
    expect(Style.starting(undefined, values)).toEqual({ style: domProject(values), attrs: {} })
  })

  it("ST10: an svg-inner element's keys become attributes, its transform stays style", () => {
    const { style, attrs } = Style.starting("circle", { cx: 10, opacity: 0.5, x: 5 })
    expect(attrs).toEqual({ cx: "10", opacity: "0.5" })
    expect(String(style.transform)).toContain("translateX(5px)")
    expect(style["transform-box"]).toBe("fill-box")
    expect(style["transform-origin"]).toBe("50% 50%")
  })

  // #57 (ADR-0023, ADR-0021's amendment): the Starting style is `project`'s, so an `initial`
  // whose transform keys are all at their identity renders `transform: none`, Motion's server
  // markup (`motion` 13.5.0: S1-S3, S10 in docs/research/identity-transform.md).
  it("ST15: an identity initial's Starting style is transform: none; a non-identity key keeps only its own function", () => {
    expect(Style.starting("div", { opacity: 0, scale: 1 })).toEqual({ style: { opacity: 0, transform: "none" }, attrs: {} })
    expect(Style.starting(undefined, { x: 0, y: "0%", rotate: "0deg" })).toEqual({ style: { transform: "none" }, attrs: {} })
    expect(Style.starting("div", { x: 10, scale: 1 })).toEqual({ style: { transform: "translateX(10px)" }, attrs: {} })
  })

  it("ST16: an svg-inner element's identity initial is transform: none, with transform-box and transform-origin", () => {
    expect(Style.starting("circle", { scale: 1, cx: 10 })).toEqual({
      style: { transform: "none", "transform-box": "fill-box", "transform-origin": "50% 50%" },
      attrs: { cx: "10" },
    })
  })

  it("ST11: the svg root's Starting style is all style", () => {
    expect(Style.starting("svg", { opacity: 0 })).toEqual({ style: domProject({ opacity: 0 }), attrs: {} })
  })

  it("ST12: splitPatchForTag routes pathLength and attrX as splitPatch does", () => {
    expect(Svg.splitPatchForTag("path", { pathLength: 0.5, attrX: 3 }).attrs).toEqual({
      pathLength: "1",
      "stroke-dasharray": "0.5 1",
      "stroke-dashoffset": "0",
      x: "3",
    })
  })

  it("ST13: isSvgInnerTag knows SVG's inner elements, not the root or HTML's", () => {
    for (const tag of ["circle", "rect", "path", "g", "text", "clipPath", "linearGradient", "feGaussianBlur"]) {
      expect(Svg.isInnerTag(tag), tag).toBe(true)
    }
    for (const tag of ["svg", "div", "a", "title", "span", "my-element"]) expect(Svg.isInnerTag(tag), tag).toBe(false)
  })
})

// The style after the first frame (ADR-0034): the user's, as `mergeStyle` merges it, without the
// keys the flush gate holds on the element. Wardic writes those; `style` is their fallback.
describe("The fallback style (ADR-0034)", () => {
  it("FS1: leaves out the keys the gate holds and keeps the user's others", () => {
    expect(Style.fallback({ opacity: 0.5, color: "red" }, ["opacity", "transform"])).toEqual({ color: "red" })
  })

  it("FS2: matches a held patch key by its CSS property, dash-cased", () => {
    expect(Style.fallback({ "background-color": "red", width: "4px" }, ["backgroundColor"])).toEqual({ width: "4px" })
  })

  it("FS3: parses a user style given as CSS text, so it's never written as cssText", () => {
    expect(Style.fallback("color: red; opacity: 0.5", ["opacity"])).toEqual({ color: "red" })
  })

  it("FS4: an element with no user style gets an empty style, never undefined", () => {
    expect(Style.fallback(undefined, ["opacity"])).toEqual({})
  })

  it("FS5: leaves out a held key from a drag element's defaults and a base style too", () => {
    const defaults = Style.dragDefaults(true)
    const out = Style.fallback({ color: "red" }, ["touch-action", "z-index"], defaults, { "z-index": "0", position: "relative" })
    expect("touch-action" in out).toBe(false)
    expect("z-index" in out).toBe(false)
    expect(out).toMatchObject({ color: "red", position: "relative" })
  })

  it("FS6: heldTouches is true only when a key taken or let go of is one the style sets", () => {
    const style = { opacity: "0.5", "background-color": "red" }
    expect(Style.heldTouches(style, [], ["transform"])).toBe(false)
    expect(Style.heldTouches(style, [], ["transform", "opacity"])).toBe(true)
    expect(Style.heldTouches(style, ["opacity"], [])).toBe(true)
    expect(Style.heldTouches(style, ["opacity"], ["opacity", "transform"])).toBe(false)
    expect(Style.heldTouches(style, [], ["backgroundColor"])).toBe(true)
  })

  it("FS7 (#151): a held custom property matches only its own name: a separate `--brand-color` stays", () => {
    expect(Style.fallback({ "--brand-color": "red", "--brandColor": "blue" }, ["--brandColor"])).toEqual({ "--brand-color": "red" })
    expect(Style.heldTouches({ "--brand-color": "red" }, [], ["--brandColor"])).toBe(false)
    expect(Style.heldTouches({ "--brandColor": "blue" }, [], ["--brandColor"])).toBe(true)
  })

  it("FS8 (#151): a server routes an svg-inner tag's custom property to style", () => {
    expect(Svg.splitPatchForTag("circle", { "--brandLevel": 0.4, r: 10 })).toEqual({ style: { "--brandLevel": 0.4 }, attrs: { r: "10" } })
  })
})
