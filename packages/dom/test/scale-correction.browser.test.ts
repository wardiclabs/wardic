// Scale-correction correctors (ADR-0011) — read a real element's computed
// border-radius / box-shadow (browser-resolved to px/%), then assert the corrected
// CSS string for a given per-axis visual scale.
import { afterEach, expect, it } from "@effect/vitest"
import { borderRadiusCorrector, boxShadowCorrector } from "@wardic/dom"

let els: Array<HTMLElement> = []
const mk = (css: string): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText = `position:absolute;width:100px;height:100px;${css}`
  document.body.appendChild(el)
  els.push(el)
  return el
}
afterEach(() => {
  for (const el of els) el.remove()
  els = []
})

it("borderRadius: px corners divide per axis; unit scale restores the base", () => {
  const el = mk("border-radius:20px")
  const base = borderRadiusCorrector.read(el)
  expect(base).toBeDefined()
  // 2x uniform -> 20/2 = 10px every corner, H and V.
  expect(borderRadiusCorrector.correct(base, 2, 2)).toBe("10px 10px 10px 10px / 10px 10px 10px 10px")
  // non-uniform (2,1) -> H 10px, V 20px (elliptical).
  expect(borderRadiusCorrector.correct(base, 2, 1)).toBe("10px 10px 10px 10px / 20px 20px 20px 20px")
  // unit scale -> base restored.
  expect(borderRadiusCorrector.correct(base, 1, 1)).toBe("20px 20px 20px 20px / 20px 20px 20px 20px")
})

it("borderRadius: percentages are self-correcting (pass through)", () => {
  const el = mk("border-radius:50%")
  const base = borderRadiusCorrector.read(el)
  expect(borderRadiusCorrector.correct(base, 2, 3)).toBe("50% 50% 50% 50% / 50% 50% 50% 50%")
})

it("borderRadius: per-corner + elliptical grammar round-trips, px corrected", () => {
  // top-left 10px, top-right 20px, bottom-right 30px, bottom-left 40px (circular each).
  const el = mk("border-radius:10px 20px 30px 40px")
  const base = borderRadiusCorrector.read(el)
  expect(borderRadiusCorrector.correct(base, 2, 2)).toBe("5px 10px 15px 20px / 5px 10px 15px 20px")
})

it("borderRadius: read returns undefined for a zero radius (nothing to correct)", () => {
  expect(borderRadiusCorrector.read(mk("border-radius:0"))).toBeUndefined()
})

it("boxShadow: offsets per axis, blur+spread by the axis mean, color verbatim", () => {
  const el = mk("box-shadow:2px 4px 6px 8px rgb(255, 0, 0)")
  const base = boxShadowCorrector.read(el)
  expect(base).toBeDefined()
  // (2,2): x 2/2=1, y 4/2=2, blur 6/2=3, spread 8/2=4.
  expect(boxShadowCorrector.correct(base, 2, 2)).toBe("1px 2px 3px 4px rgb(255, 0, 0)")
  // non-uniform (2,1): x 1, y 4, blur 6/mean(1.5)=4, spread 8/1.5≈5.33.
  const nonUniform = boxShadowCorrector.correct(base, 2, 1)
  expect(nonUniform.startsWith("1px 4px ")).toBe(true)
  expect(nonUniform).toContain("rgb(255, 0, 0)")
})

it("boxShadow: multi-layer (paren-aware comma split) + inset are preserved", () => {
  const el = mk("box-shadow:2px 2px 4px rgb(255, 0, 0), inset 4px 4px 8px rgb(0, 0, 255)")
  const base = boxShadowCorrector.read(el)
  const out = boxShadowCorrector.correct(base, 2, 2)
  const layers = out.split(/,(?![^(]*\))/) // top-level comma split for the assertion
  expect(layers.length).toBe(2)
  expect(layers[0]!.trim().startsWith("1px 1px 2px")).toBe(true) // 2/2, 2/2, 4/2
  expect(layers[1]!.trim().startsWith("inset 2px 2px 4px")).toBe(true) // inset preserved, 4/2 each
  expect(out).toContain("rgb(255, 0, 0)")
  expect(out).toContain("rgb(0, 0, 255)")
})

it("boxShadow: read returns undefined for `none`", () => {
  expect(boxShadowCorrector.read(mk(""))).toBeUndefined()
})
