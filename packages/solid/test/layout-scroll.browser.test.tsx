// layoutScroll (ADR-0012) in a REAL browser. The core invariant: a scroll change
// BETWEEN triggers must NOT leak into the FLIP delta — folding the scroll out keeps
// the box scroll-stable, so a re-measure after scrolling sees no logical move and
// produces no spurious FLIP. Without the fold, the item would seed at its
// pre-scroll position and animate back (a visible jump).
import { cleanup, render } from "@solidjs/testing-library"
import { wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { createSignal } from "solid-js"
import { raf, topOf } from "./browser-helpers.ts"

afterEach(() => {
  window.scrollTo(0, 0) // reset page scroll between tests
  cleanup()
})

const CSS = `
  .sc{position:absolute;top:0;left:0;width:120px;height:80px;overflow:auto}
  .content{position:relative;height:400px}
  .it{position:absolute;top:150px;left:10px;width:50px;height:30px}
  .tall{position:relative;height:2000px}
  .wi{position:absolute;top:500px;left:10px;width:50px;height:30px}
  .fixed-sc{position:fixed;top:0;left:0;width:120px;height:80px;overflow:auto}
`

/** Drive `n` frames, flagging if `it` ever jumps back near `oldTop` (a spurious FLIP). */
const watchForJumpBack = async (el: HTMLElement, oldTop: number, n: number): Promise<boolean> => {
  let jumped = false
  for (let i = 0; i < n; i++) {
    await raf()
    if (Math.abs(topOf(el) - oldTop) < 10) jumped = true
  }
  return jumped
}

it("a layoutScroll container folds its scroll out — scrolling then re-measuring is NOT a FLIP", async () => {
  const [dep, setDep] = createSignal(0)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <wardic.div data-sc class="sc" layoutScroll>
        <div class="content">
          <wardic.div data-it class="it" layout layoutDependency={dep()} />
        </div>
      </wardic.div>
    </WardicProvider>
  ))
  const sc = container.querySelector("[data-sc]") as HTMLElement
  const it = container.querySelector("[data-it]") as HTMLElement
  await raf()
  await raf() // item measured (retained), container at scroll 0
  const topBefore = topOf(it)

  sc.scrollTop = 50 // scroll the container — the item moves UP ~50px in the viewport
  await raf()
  const scrolledTop = topOf(it)
  expect(topBefore - scrolledTop).toBeCloseTo(50, 0) // confirm it actually scrolled

  setDep(1) // re-measure trigger (NO layout change) — the scroll must not become a FLIP
  const jumped = await watchForJumpBack(it, topBefore, 12)
  expect(jumped).toBe(false) // scroll folded out -> no spurious FLIP back to the old position
  expect(Math.abs(topOf(it) - scrolledTop)).toBeLessThan(2) // stays at its scrolled position
})

it("page/window scroll is auto-folded — scrolling the page then re-measuring is NOT a FLIP", async () => {
  const [dep, setDep] = createSignal(0)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="tall">
        <wardic.div data-wi class="wi" layout layoutDependency={dep()} />
      </div>
    </WardicProvider>
  ))
  const it = container.querySelector("[data-wi]") as HTMLElement
  await raf()
  await raf()
  const topBefore = topOf(it)

  window.scrollTo(0, 100) // scroll the PAGE (no layoutScroll prop needed — root scroll)
  await raf()
  const scrolledTop = topOf(it)
  expect(topBefore - scrolledTop).toBeCloseTo(100, 0)

  setDep(1)
  const jumped = await watchForJumpBack(it, topBefore, 12)
  expect(jumped).toBe(false) // window scroll auto-folded -> no spurious FLIP
  expect(Math.abs(topOf(it) - scrolledTop)).toBeLessThan(2)
})

it("a position:fixed layoutScroll container is a scroll root — its subtree does NOT fold page scroll", async () => {
  const [dep, setDep] = createSignal(0)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      {/* tall spacer so the page can scroll, plus a FIXED scroll container */}
      <div class="tall" />
      <wardic.div data-fx class="fixed-sc" layoutScroll>
        <div class="content">
          <wardic.div data-it class="it" layout layoutDependency={dep()} />
        </div>
      </wardic.div>
    </WardicProvider>
  ))
  const it = container.querySelector("[data-it]") as HTMLElement
  await raf()
  await raf()
  const topBefore = topOf(it) // fixed -> viewport position, scroll-independent

  window.scrollTo(0, 150) // page scrolls, but the fixed container + item do NOT move
  await raf()
  expect(Math.abs(topOf(it) - topBefore)).toBeLessThan(2) // confirm the item didn't move (fixed)

  setDep(1)
  // The scroll-root check must SKIP the page-scroll fold for this fixed subtree; if it
  // wrongly added window scroll, the stable box would shift -> a spurious FLIP.
  const jumped = await watchForJumpBack(it, topBefore + 150, 12) // a wrong fold would seed it +150 off
  expect(jumped).toBe(false)
  expect(Math.abs(topOf(it) - topBefore)).toBeLessThan(2) // stays put
})
