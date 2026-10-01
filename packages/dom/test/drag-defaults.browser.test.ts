// The drag-element defaults (ADR-0019, *Amendment (Reorder)*, #36): the style map and
// attribute every `drag` element gets, as Motion's draggables do
// (render/html/use-props.ts:57-73 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), in
// kebab-case for Solid's style objects and the renderer's setProperty.
import { describe, expect, it } from "@effect/vitest"
import { DRAG_DEFAULT_ATTRIBUTES, dragDefaultStyle, reorderTouchAction } from "../src/index.ts"

describe("drag-element defaults (#36)", () => {
  it("DD1: a free drag gets touch-action none and no text selection or iOS callout", () => {
    expect(dragDefaultStyle(true)).toEqual({
      "touch-action": "none",
      "user-select": "none",
      "-webkit-user-select": "none",
      "-webkit-touch-callout": "none",
    })
  })

  it("DD2: an axis-locked drag keeps the other axis's panning, and each axis's map is one object", () => {
    expect(dragDefaultStyle("x")["touch-action"]).toBe("pan-y")
    expect(dragDefaultStyle("y")["touch-action"]).toBe("pan-x")
    expect(dragDefaultStyle("x")).toBe(dragDefaultStyle("x"))
    expect(dragDefaultStyle(true)).toBe(dragDefaultStyle(true))
    expect(Object.isFrozen(dragDefaultStyle("y"))).toBe(true)
  })

  it("DD3: a Reorder item's touch-action follows its group's axis, and the attribute is draggable=\"false\"", () => {
    expect(reorderTouchAction("y")).toBe("pan-x")
    expect(reorderTouchAction("x")).toBe("pan-y")
    expect(reorderTouchAction("xy")).toBe("none")
    expect(DRAG_DEFAULT_ATTRIBUTES).toEqual({ draggable: "false" })
  })
})
