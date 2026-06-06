// Layout FLIP / projection tests in a REAL browser. happy-dom has no layout
// engine (getBoundingClientRect is all-zeros), so the old version MOCKED boxes and
// asserted the inverted-transform wiring. Here layout is REAL: elements move/scale
// via reactive class, and we assert the actual measured geometry — including the
// treeScale counter-scale, which mocked boxes could never verify.
import { cleanup, render } from "@solidjs/testing-library"
import { LayoutGroup, measureLayoutBox, wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { createSignal } from "solid-js"
import { leftOf, raf, topOf, until, widthOf } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .lf-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .lf-box.moved{left:200px}
  .lf-parent{position:absolute;top:0;left:0;width:100px;height:100px}
  .lf-parent.grown{width:200px;height:200px}
  .lf-round{border-radius:20px;box-shadow:4px 4px 8px rgb(0, 0, 0)}
  .lf-child{position:absolute;top:0;left:0;width:50px;height:50px}
  .col{position:relative;display:flex;flex-direction:column;width:200px}
  .row-a{height:50px}
  .row-a.tall{height:150px}
  .row-b{height:50px}
`

it("measureLayoutBox reads the UNTRANSFORMED box and restores the inline transform", () => {
  const el = document.createElement("div")
  el.style.cssText = "position:absolute;left:30px;top:20px;width:100px;height:40px;transform:translateX(500px)"
  document.body.appendChild(el)
  const box = measureLayoutBox(el)
  expect(box.left).toBeCloseTo(30, 0) // untransformed (not 530)
  expect(box.width).toBeCloseTo(100, 0)
  expect(el.style.transform).toBe("translateX(500px)") // restored
  el.remove()
})

it("standalone layout: a moved element FLIPs from its old position to its new one", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "200px" }}>
        <wardic.div data-box class="lf-box" classList={{ moved: moved() }} layout layoutDependency={moved()} />
      </div>
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement
  await raf()
  await raf()
  const base = leftOf(box)

  setMoved(true)
  await until(() => leftOf(box) < base + 50) // FLIP seeds: snaps back near the old position
  let sawMid = false
  await until(() => {
    const l = leftOf(box)
    if (l > base + 30 && l < base + 170) sawMid = true
    return l >= base + 199
  })
  expect(sawMid).toBe(true) // animated THROUGH the range (not an instant jump)
  expect(Math.abs(leftOf(box) - (base + 200))).toBeLessThan(1.5)
})

it("LayoutGroup sibling reflow: growing A pushes B, and B FLIPs to its new position", async () => {
  const [grown, setGrown] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <LayoutGroup layoutDependency={grown()}>
        <div class="col">
          <wardic.div data-a class="row-a" classList={{ tall: grown() }} layout />
          <wardic.div data-b class="row-b" layout />
        </div>
      </LayoutGroup>
    </WardicProvider>
  ))
  const b = container.querySelector("[data-b]") as HTMLElement
  await raf()
  await raf()
  const bTop0 = topOf(b)

  setGrown(true) // A: 50 -> 150 tall, pushing B down by 100
  await until(() => topOf(b) < bTop0 + 50) // B FLIP seeds back near its old top
  let sawMid = false
  await until(() => {
    const t = topOf(b)
    if (t > bTop0 + 20 && t < bTop0 + 80) sawMid = true
    return t >= bTop0 + 99
  })
  expect(sawMid).toBe(true) // B animated through the reflow (sibling reflow via whole-tree measure)
  expect(Math.abs(topOf(b) - (bTop0 + 100))).toBeLessThan(2)
})

it("nested treeScale: a scaling layout parent keeps its layout child's rendered size constant (counter-scale)", async () => {
  const [grown, setGrown] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "400px" }}>
        <wardic.div data-parent class="lf-parent" classList={{ grown: grown() }} layout layoutDependency={grown()}>
          <wardic.div data-child class="lf-child" layout />
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  const parent = container.querySelector("[data-parent]") as HTMLElement
  const child = container.querySelector("[data-child]") as HTMLElement
  await raf()
  await raf()
  expect(widthOf(child)).toBeCloseTo(50, 0)

  setGrown(true) // parent 100 -> 200 (scales 2x); child must counter-scale to stay 50
  let worstW = 0
  await until(() => {
    worstW = Math.max(worstW, Math.abs(widthOf(child) - 50))
    return Math.abs(widthOf(parent) - 200) < 2 // parent settled at its new size
  })
  // Child's RENDERED width stayed ~50 throughout the parent's scale (treeScale counter-scale).
  expect(worstW).toBeLessThan(6)
  expect(widthOf(child)).toBeCloseTo(50, 0)
})

it("scale-correction (P2): a scaling layout element keeps its rendered border-radius + shadow visually constant", async () => {
  const [grown, setGrown] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "400px" }}>
        {/* border-radius / box-shadow come from a CLASS (not the style prop) so the
            projection's corrected inline value is the only one in style.* */}
        <wardic.div data-box class="lf-parent lf-round" classList={{ grown: grown() }} layout layoutDependency={grown()} />
      </div>
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement
  await raf()
  await raf()
  expect(box.style.borderRadius).toBe("") // unscaled: no correction, the class's 20px shows

  setGrown(true) // 100 -> 200: the element scales during the FLIP, so the radius/shadow distort
  // Seed-wait: the FLIP seeds the box scaled-DOWN to its old size (~100px); wait for
  // that so we don't sample the raw post-class width (200, no transform) before the
  // projection engages.
  await until(() => widthOf(box) < 150)
  let sawCorrected = false
  let worstRenderedRadius = 0
  await until(() => {
    const cr = box.style.borderRadius
    const h = Number.parseFloat(cr) // top-left horizontal radius of the corrected shorthand
    if (cr !== "" && Number.isFinite(h)) {
      const scale = widthOf(box) / 200 // visual scale (layout box is the grown 200px)
      if (Math.abs(h - 20) > 2) sawCorrected = true // corrected away from the authored 20px
      worstRenderedRadius = Math.max(worstRenderedRadius, Math.abs(h * scale - 20))
    }
    return Math.abs(widthOf(box) - 200) < 2 // settled at the grown size
  })
  // The radius WAS corrected (inline value diverged from 20px) and, once the
  // transform scales it, RENDERS at the authored 20px throughout the scale.
  expect(sawCorrected).toBe(true)
  expect(worstRenderedRadius).toBeLessThan(3)
  // box-shadow is corrected too (the projection drove an inline value during the scale).
  expect(box.style.boxShadow).not.toBe("")
})
