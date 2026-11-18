// dom's `PagePoint` (#443; #795): the point mappings a provider's `transformPagePoint` takes, at
// their own seam, with the selector form the Foldkit binding needs.
//
// - PG1: `correctParentTransform` given a selector turns a point back through the parent's scale,
//   about the parent's centre.
// - PG2: a selector that finds nothing, and an SVG selector that finds no SVG, pass points through.
// - PG3: `transformViewBoxPoint` given a selector scales a point into the viewBox's units.
import { correctParentTransform, transformViewBoxPoint } from "@wardic/dom/unstable/PagePoint"
import { afterEach, describe, expect, it } from "vitest"

afterEach(() => {
  document.body.innerHTML = ""
})

/** A `div#plan` 200 by 100 at (100, 100), scaled 2× about its centre, as the page sees it. */
const scaledPlan = (): HTMLElement => {
  const plan = document.createElement("div")
  plan.id = "plan"
  plan.style.cssText = "position:absolute;left:100px;top:100px;width:200px;height:100px;transform:scale(2)"
  document.body.append(plan)
  return plan
}

describe("PagePoint (#795)", () => {
  it("PG1: correctParentTransform given a selector maps a point through the parent's scale, about its centre", () => {
    scaledPlan()
    const map = correctParentTransform("#plan")
    // The centre stays; a point 60 px right of it is 30 in the plan's units.
    expect(map({ x: 200, y: 150 })).toEqual({ x: 200, y: 150 })
    expect(map({ x: 260, y: 150 })).toEqual({ x: 230, y: 150 })
  })

  it("PG2: a selector that finds nothing passes points through, and so does an SVG selector that finds no SVG", () => {
    scaledPlan()
    expect(correctParentTransform("#missing")({ x: 260, y: 150 })).toEqual({ x: 260, y: 150 })
    expect(transformViewBoxPoint("#plan")({ x: 260, y: 150 })).toEqual({ x: 260, y: 150 })
  })

  it("PG3: transformViewBoxPoint given a selector scales a point into the viewBox's units", () => {
    document.body.innerHTML = '<svg id="drawing" viewBox="0 0 100 100" width="400" height="400" style="position:absolute;left:0;top:0"></svg>'
    const map = transformViewBoxPoint("#drawing")
    // Drawn at 4× its viewBox: 200 px across the page is 50 in its units.
    expect(map({ x: 200, y: 200 })).toEqual({ x: 50, y: 50 })
  })
})
