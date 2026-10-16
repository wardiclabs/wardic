// The drag-element defaults (ADR-0019, *Amendment (Reorder)*, #36): the style map and
// attribute every `drag` element gets, as Motion's draggables do
// (render/html/use-props.ts:57-73 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), in
// kebab-case for Solid's style objects and the renderer's setProperty.
import { describe, expect, it } from "@effect/vitest"
import * as Style from "@wardic/dom/Style"

describe("drag-element defaults (#36)", () => {
  it("DD1: a free drag gets touch-action none and no text selection or iOS callout", () => {
    expect(Style.dragDefaults(true)).toEqual({
      "touch-action": "none",
      "user-select": "none",
      "-webkit-user-select": "none",
      "-webkit-touch-callout": "none",
    })
  })

  it("DD2: an axis-locked drag keeps the other axis's panning, and each axis's map is one object", () => {
    expect(Style.dragDefaults("x")["touch-action"]).toBe("pan-y")
    expect(Style.dragDefaults("y")["touch-action"]).toBe("pan-x")
    expect(Style.dragDefaults("x")).toBe(Style.dragDefaults("x"))
    expect(Style.dragDefaults(true)).toBe(Style.dragDefaults(true))
    expect(Object.isFrozen(Style.dragDefaults("y"))).toBe(true)
  })

  it("DD3: a Reorder item's touch-action follows its group's axis, and the attribute is draggable=\"false\"", () => {
    expect(Style.reorderTouchAction("y")).toBe("pan-x")
    expect(Style.reorderTouchAction("x")).toBe("pan-y")
    expect(Style.reorderTouchAction("xy")).toBe("none")
    expect(Style.DRAG_DEFAULT_ATTRIBUTES).toEqual({ draggable: "false" })
  })
})
