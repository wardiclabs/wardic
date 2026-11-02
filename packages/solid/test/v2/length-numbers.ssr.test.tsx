// A bare number on a CSS length (#522, Motion's `animate={{ height: 200 }}`), on Solid 2: the types
// take it where the renderer draws it in px (`DomRenderer.LENGTH_KEYS`), and the server draws it so.
//
// - LN1: every kind of target takes a number on a length: `initial`, `animate`, `exit`, a `while*`, a
//   variant, a Keyframes list mixing numbers and strings, a Transition end. `line-height` takes its
//   unitless number, as ever. A number on a length the renderer doesn't draw in px (`flex-basis`) is
//   rejected, so a number never draws CSS a browser drops.
// - LN2: the server draws the Starting style's numbers in px (`height: 200px`, `margin-top: 20px`),
//   and `line-height`'s as it is.
import { wardic, type WardicTargetValues, type WardicVariant } from "@wardic/solid/unstable/v2"
import { describe, expect, expectTypeOf, it } from "vitest"
import { serve, tagsOf } from "./ssr.ts"

describe("a bare number on a CSS length, on Solid 2 (#522)", () => {
  it("LN1: every kind of target takes a number on a length; not on one drawn as it is", () => {
    expectTypeOf<{ readonly height: 200; readonly "margin-top": 20; readonly "border-radius": 8 }>().toExtend<WardicTargetValues>()
    expectTypeOf<{ readonly height: readonly [0, "100px", 200] }>().toExtend<WardicTargetValues>()
    expectTypeOf<{ readonly "line-height": 1.5 }>().toExtend<WardicTargetValues>()
    expectTypeOf<{ readonly "padding-inline": 12; readonly transitionEnd: { readonly "margin-top": 4 } }>().toExtend<WardicVariant>()
    // @ts-expect-error a number on flex-basis would be drawn as it is, which a browser drops
    const flexBasis: WardicTargetValues = { "flex-basis": 100 }
    void flexBasis
    const element = () => (
      <wardic.div
        initial={{ height: 0, "margin-top": 0 }}
        animate={{ height: 200, "margin-top": [0, "10px", 20], transitionEnd: { "font-size": 16 } }}
        exit={{ height: 0 }}
        whileHover={{ "border-radius": 8 }}
        variants={{ open: { "padding-inline": 12 } }}
      />
    )
    void element
  })

  it("LN2: the server draws the Starting style's numbers in px, and line-height's as it is", () => {
    const html = serve(() => <wardic.div data-k="box" initial={{ height: 200, "margin-top": 20, "line-height": 1.5 }} animate={{ height: 100 }} />)
    const box = tagsOf(html).find((t) => t.attrs["data-k"] === "box")
    expect(box?.style).toMatchObject({ height: "200px", "margin-top": "20px", "line-height": "1.5" })
  })
})
