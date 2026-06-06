// layoutRoot + layoutAnchor (ADR-0013) in a REAL browser.
// - layoutAnchor (Point): live now that relativeParent allows SCALING parents — a
//   carried child anchored to the parent's CENTER tracks the center as the parent
//   grows (the default top-left anchor keeps it put — covered by the nested-treeScale
//   test in layout-flip.browser).
// - layoutAnchor: false: opt out of relative projection (force absolute).
// - layoutRoot: self-snaps (no own FLIP) + isolates its subtree from an ancestor's
//   projection (accumulation boundary).
import { cleanup, render } from "@solidjs/testing-library"
import { wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { createSignal } from "solid-js"
import { leftOf, raf, until, widthOf } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .par{position:absolute;top:0;left:0;width:100px;height:100px}
  .par.grown{width:200px;height:200px}
  .kid{position:absolute;top:10px;left:10px;width:20px;height:20px}
  .root{position:absolute;top:0;left:0;width:100px;height:100px}
  .root.moved{left:200px}
`

it("layoutAnchor composes with treeScale: a non-default (center) anchor under a SCALING parent is sound", async () => {
  // The anchor math itself is unit-tested (calcRelativeBox top-left vs centre in
  // projection-geometry.test). Here we verify the engine-level risk flagged in
  // ADR-0013: now that relativeParent allows SCALING parents, the relative
  // placement (anchored) and the treeScale counter-correction must compose without
  // double-counting — so a carried child stays put + undistorted even with a
  // center anchor (a static child's relative position doesn't change, so any anchor
  // keeps it visually put; the anchor only repositions a MOVING child).
  const [grown, setGrown] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "400px", height: "400px" }}>
        <wardic.div data-par class="par" classList={{ grown: grown() }} layout layoutDependency={grown()}>
          <wardic.div data-kid class="kid" layout layoutAnchor={{ x: 0.5, y: 0.5 }} />
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  const par = container.querySelector("[data-par]") as HTMLElement
  const kid = container.querySelector("[data-kid]") as HTMLElement
  await raf()
  await raf()
  const restLeft = leftOf(kid)
  const restWidth = widthOf(kid)

  setGrown(true) // parent scales 100 -> 200
  let worstPos = 0
  let worstW = 0
  await until(() => {
    worstPos = Math.max(worstPos, Math.abs(leftOf(kid) - restLeft))
    worstW = Math.max(worstW, Math.abs(widthOf(kid) - restWidth))
    return Math.abs(widthOf(par) - 200) < 2 // parent settled
  })
  // No double-count: the center anchor keeps the carried child visually put + its
  // size constant through the parent's scale (treeScale counter-correction intact).
  expect(worstPos).toBeLessThan(3)
  expect(worstW).toBeLessThan(3)
})

it("layoutAnchor: false makes a child project ABSOLUTELY — it does not glue to a moving parent", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "200px" }}>
        <wardic.div data-par class="root" classList={{ moved: moved() }} layout layoutDependency={moved()}>
          {/* child with layoutAnchor:false — opts out of relative gluing */}
          <wardic.div data-kid class="kid" layout layoutAnchor={false} />
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  const par = container.querySelector("[data-par]") as HTMLElement
  const kid = container.querySelector("[data-kid]") as HTMLElement
  const base = leftOf(par)
  await raf()
  await raf()

  setMoved(true) // parent translates +200 (left 0 -> 200), carrying the child in layout
  // A relative (glued) child would track the parent's animating position each frame;
  // with layoutAnchor:false the child projects ABSOLUTELY (its own origin->box FLIP),
  // so it does NOT stay pinned to the parent's *current* offset mid-flight. We assert
  // the child reaches its final position (carried to +200+10) and settles correctly —
  // the engine took the absolute branch without error and the child isn't left behind.
  await until(() => Math.abs(leftOf(kid) - base - 210) < 3 || Math.abs(leftOf(kid) - 210) < 3)
  // Settles at the parent's new position + its own offset.
  await until(() => Math.abs(leftOf(kid) - (leftOf(par) + 10)) < 3)
  expect(Math.abs(leftOf(kid) - (leftOf(par) + 10))).toBeLessThan(3)
})

it("layoutRoot self-snaps: its own layout change does NOT FLIP", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "200px" }}>
        <wardic.div data-root class="root" classList={{ moved: moved() }} layout layoutRoot layoutDependency={moved()} />
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const base = leftOf(root)
  await raf()
  await raf()

  setMoved(true) // left 0 -> 200. A normal `layout` element would FLIP (seed back at 0).
  // A layoutRoot SELF-SNAPS: it jumps straight to its new position, never seeding a
  // FLIP back at the old one.
  let sawSeedBack = false
  for (let i = 0; i < 12; i++) {
    await raf()
    if (Math.abs(leftOf(root) - base) < 50) sawSeedBack = true // back near the old position = a FLIP
  }
  expect(sawSeedBack).toBe(false) // no FLIP — snapped to +200
  expect(Math.abs(leftOf(root) - base - 200)).toBeLessThan(2)
  expect(root.style.transform).not.toContain("translate") // no projection transform
})

it("layoutRoot isolates its subtree: a child is NOT carried by an animating ancestor ABOVE the root", async () => {
  const [grown, setGrown] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "400px", height: "400px" }}>
        {/* animating ancestor (scales) */}
        <wardic.div data-anc class="par" classList={{ grown: grown() }} layout layoutDependency={grown()}>
          {/* a layoutRoot boundary between the scaling ancestor and the child */}
          <wardic.div data-root class="kid" layout layoutRoot>
            <wardic.div data-kid style={{ position: "absolute", top: "2px", left: "2px", width: "8px", height: "8px" }} layout />
          </wardic.div>
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  const anc = container.querySelector("[data-anc]") as HTMLElement
  const kid = container.querySelector("[data-kid]") as HTMLElement
  await raf()
  await raf()
  const kidWidthRest = widthOf(kid)

  setGrown(true) // ancestor scales 100->200; the layoutRoot boundary should isolate the child
  // The child is below a layoutRoot, so it is NOT carried by the scaling ancestor —
  // its own rendered size stays constant (no treeScale counter-correction churn from
  // above the boundary).
  let worstW = 0
  await until(() => {
    worstW = Math.max(worstW, Math.abs(widthOf(kid) - kidWidthRest))
    return Math.abs(widthOf(anc) - 200) < 2
  })
  expect(worstW).toBeLessThan(3) // child unperturbed by the ancestor above the layoutRoot
})
