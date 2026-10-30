// A layout animation along `transition.path` on Solid 2 (#438 PR 2): Solid 1's LP1, with `wardic.*`.
//
// - LPV1: a `layout` move of 300 px, `arc({ strength: 1 })`: its centre bulges by half the distance
//   midway, and it lands on its box.
import { DomLive } from "@wardic/dom"
import { arc, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const centreOf = (el: Element): { readonly x: number; readonly y: number } => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
const CURVED: WardicTransition = { layout: { type: "tween", duration: 0.6, ease: "linear", path: arc({ strength: 1 }) } }

describe("a layout animation along transition.path on Solid 2 (#438)", () => {
  it("LPV1: a layout move of 300 px bulges by half the distance midway, and lands on its box", async () => {
    const [left, setLeft] = createSignal(0)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", "margin-left": "40px", "margin-top": "200px", height: "400px", "padding-left": `${left()}px`, "padding-top": "100px" }}>
          <wardic.div data-k="box" layout layoutDependency={left()} transition={CURVED} style={{ width: "40px", height: "40px", background: "teal" }} />
        </div>
      </WardicProvider>
    ))
    for (let i = 0; i < 5; i++) await raf()
    const box = host.querySelector<HTMLElement>("[data-k=box]")!
    const start = centreOf(box)
    setLeft(300)
    let bulge = 0
    for (let i = 0; i < 50; i++) {
      await raf()
      bulge = Math.max(bulge, Math.abs(centreOf(box).y - start.y))
    }
    expect(bulge).toBeGreaterThan(130)
    expect(bulge).toBeLessThan(151)
    expect(centreOf(box).x - start.x).toBeCloseTo(300, 0)
    expect(centreOf(box).y).toBeCloseTo(start.y, 0)
  })
})
