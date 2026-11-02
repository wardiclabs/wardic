// The CSS lengths a bare number is drawn in `px` on (#522, Motion's `animate={{ height: 200 }}`):
// `DomRenderer.LENGTH_KEYS`, spelled as Wardic's keys are.
//
// - LK1: a number on a one-word length and on a multi-word one (`margin-top`) is drawn in px; a
//   string is drawn as it is.
// - LK2: `line-height` keeps its number, a multiple in CSS, as do `opacity`, `z-index` and a custom
//   property.
// - LK3: the list is Motion's `px` keys (motion-dom's `numberValueTypes`), in Wardic's spelling, plus
//   `min-width`, `min-height`, the gaps and `letter-spacing`.
import * as DomRenderer from "@wardic/dom/DomRenderer"
import { describe, expect, it } from "vitest"

/** Motion's `numberValueTypes` keys whose type is `px`, motion-dom at 16c6122. */
const MOTION_PX_KEYS = [
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
  "width",
  "maxWidth",
  "height",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "insetBlock",
  "insetBlockStart",
  "insetBlockEnd",
  "insetInline",
  "insetInlineStart",
  "insetInlineEnd",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingBlock",
  "paddingBlockStart",
  "paddingBlockEnd",
  "paddingInline",
  "paddingInlineStart",
  "paddingInlineEnd",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginBlock",
  "marginBlockStart",
  "marginBlockEnd",
  "marginInline",
  "marginInlineStart",
  "marginInlineEnd",
  "fontSize",
  "backgroundPositionX",
  "backgroundPositionY",
]

const hyphenated = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

describe("the CSS lengths a number is drawn in px on (#522)", () => {
  it("LK1: a number on a one-word and a multi-word length is drawn in px; a string as it is", () => {
    const patch = DomRenderer.project({ height: 200, "margin-top": 20, "border-top-left-radius": 8, "padding-inline": 4, width: "50%" })
    expect(patch).toEqual({ height: "200px", "margin-top": "20px", "border-top-left-radius": "8px", "padding-inline": "4px", width: "50%" })
  })

  it("LK2: line-height keeps its number, as do opacity, z-index and a custom property", () => {
    const patch = DomRenderer.project({ "line-height": 1.5, opacity: 0.5, "z-index": 2, "--size": 3 })
    expect(patch).toEqual({ "line-height": 1.5, opacity: 0.5, "z-index": 2, "--size": 3 })
  })

  it("LK3: Motion's px keys, in Wardic's spelling, and Wardic's own", () => {
    const own = ["min-width", "min-height", "gap", "row-gap", "column-gap", "letter-spacing"]
    expect([...DomRenderer.LENGTH_KEYS].sort()).toEqual([...MOTION_PX_KEYS.map(hyphenated), ...own].sort())
  })
})
