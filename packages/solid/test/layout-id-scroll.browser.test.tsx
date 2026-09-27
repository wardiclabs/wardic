// Regression: a `layoutId` switch must start the entering twin at the leaving twin's
// PAINTED box, whatever the page or container scroll (issue #13). The switch seed was
// read in a different coordinate frame from the enterer's stored box: the seed was a
// raw viewport box, while the measure pass stores every box in the scroll-stable
// frame (ADR-0012: viewport + root scroll + `layoutScroll` ancestors' scroll). The FLIP
// origin was therefore off by the fold, so with the page scrolled the twin flew in
// from ~1300px away, and an unmoved twin animated at all. The fix captures the seed in
// the Root frame and rebases it into the enterer's frame at its first measure
// (ADR-0012 / ADR-0010 amendments, #13).
//
// Only the real-browser tier can catch it: the bug is a mismatch between real
// `getBoundingClientRect` readings and real scroll offsets. happy-dom zeroes every
// rect and never scrolls, so both frames collapse to the same numbers there.
//
// How a frame is read: `paintedNextFrame` registers a `requestAnimationFrame`
// immediately after the swap. The swap itself registers the gate's flush rAF first
// (the enterer's registration schedules the measure pass), so ours runs after that
// flush in the SAME frame and reads the box that frame paints.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { createSignal, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(() => {
  window.scrollTo(0, 0)
  cleanup()
})

const PAGE_SCROLL = 1350

const CSS = `
  .ls-root{position:relative;width:360px;height:5000px}
  .ls-twin{position:absolute;width:100px;height:40px}
  .ls-a{left:20px;top:1450px}
  .ls-b{left:200px;top:1570px}
  .ls-same{left:120px;top:1450px}
  .ls-row{position:relative;width:360px;height:220px}
  .ls-sc{position:absolute;top:0;width:160px;height:200px;overflow:auto}
  .ls-sc1{left:0}
  .ls-sc2{left:190px}
  .ls-content{position:relative;height:600px}
  .ls-in-a{left:10px;top:168px}
  .ls-in-b{left:30px;top:88px}
`

const q = (root: ParentNode, selector: string): HTMLElement => root.querySelector(selector) as HTMLElement

/**
 * The box `el()` paints in the NEXT frame. Call it synchronously right after the
 * swap, so this rAF queues behind the gate's flush and reads the projected frame.
 */
const paintedNextFrame = (el: () => HTMLElement): Promise<DOMRect> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(el().getBoundingClientRect())))

const expectSameCorner = (actual: DOMRect, expected: DOMRect): void => {
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(actual.top - expected.top)).toBeLessThanOrEqual(1)
}

/** Scroll the window and confirm the browser honoured it (the page is tall enough). */
const scrollWindow = async (y: number): Promise<void> => {
  window.scrollTo(0, y)
  await raf()
  expect(window.scrollY).toBeCloseTo(y, 0)
}

it("page scrolled 1350px: a <Show> swap paints the enterer's first frame at the leaver's box, then settles home", async () => {
  const [atB, setAtB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div data-root class="ls-root">
        <Show when={atB()} fallback={<wardic.div data-a class="ls-twin ls-a" layoutId="scrolled" />}>
          <wardic.div data-b class="ls-twin ls-b" layoutId="scrolled" />
        </Show>
      </div>
    </WardicProvider>
  ))
  await raf()
  await raf()
  await scrollWindow(PAGE_SCROLL)
  await raf()
  const aBox = q(container, "[data-a]").getBoundingClientRect()

  setAtB(true)
  const first = await paintedNextFrame(() => q(container, "[data-b]"))
  expectSameCorner(first, aBox)

  // Then B springs to its own layout box (root-relative 200, 1570).
  const b = q(container, "[data-b]")
  const root = q(container, "[data-root]").getBoundingClientRect()
  const homeLeft = root.left + 200
  const homeTop = root.top + 1570
  await until(() => {
    const r = b.getBoundingClientRect()
    return Math.abs(r.left - homeLeft) < 1 && Math.abs(r.top - homeTop) < 1
  })
  const settled = b.getBoundingClientRect()
  expect(Math.abs(settled.left - homeLeft)).toBeLessThan(1)
  expect(Math.abs(settled.top - homeTop)).toBeLessThan(1)
})

it("page scrolled: a swap between twins at the SAME box does not move at all", async () => {
  const [atB, setAtB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="ls-root">
        <Show when={atB()} fallback={<wardic.div data-a class="ls-twin ls-same" layoutId="unmoved" />}>
          <wardic.div data-b class="ls-twin ls-same" layoutId="unmoved" />
        </Show>
      </div>
    </WardicProvider>
  ))
  await raf()
  await raf()
  await scrollWindow(PAGE_SCROLL)
  await raf()
  const aBox = q(container, "[data-a]").getBoundingClientRect()

  setAtB(true)
  const first = await paintedNextFrame(() => q(container, "[data-b]"))
  const b = q(container, "[data-b]")
  expect(b.style.transform).not.toContain("translate")
  expectSameCorner(first, aBox)

  // 12 consecutive frames: nothing to animate, so B never leaves the shared box.
  let worst = 0
  for (let i = 0; i < 12; i++) {
    await raf()
    const r = b.getBoundingClientRect()
    worst = Math.max(worst, Math.abs(r.left - aBox.left), Math.abs(r.top - aBox.top))
  }
  expect(worst).toBeLessThanOrEqual(1)
  expect(b.style.transform).not.toContain("translate")
})

it("twins in two differently-scrolled layoutScroll containers: the enterer's first frame is at the leaver's box", async () => {
  // Decision 9's `split` geometry: A sits at content-top 168 in C1 scrolled 120, B at
  // content-top 88 in C2 scrolled 40, so both show 48px below their container's top.
  // The two scrolls differ, which is what separates the Root-frame seed from folding
  // each twin with its own ancestry (that is off by 120 - 40 = 80px).
  const [atB, setAtB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="ls-row">
        <wardic.div data-c1 class="ls-sc ls-sc1" layoutScroll>
          <div class="ls-content">
            <Show when={!atB()}>
              <wardic.div data-a class="ls-twin ls-in-a" layoutId="split" />
            </Show>
          </div>
        </wardic.div>
        <wardic.div data-c2 class="ls-sc ls-sc2" layoutScroll>
          <div class="ls-content">
            <Show when={atB()}>
              <wardic.div data-b class="ls-twin ls-in-b" layoutId="split" />
            </Show>
          </div>
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  await raf()
  await raf()
  const c1 = q(container, "[data-c1]")
  const c2 = q(container, "[data-c2]")
  c1.scrollTop = 120
  c2.scrollTop = 40
  await raf()
  expect(c1.scrollTop).toBe(120)
  expect(c2.scrollTop).toBe(40)
  await raf()
  const aBox = q(container, "[data-a]").getBoundingClientRect()

  setAtB(true)
  const first = await paintedNextFrame(() => q(container, "[data-b]"))
  expectSameCorner(first, aBox)
})

it("register-then-dispose: the enterer mounts first, the leaver unmounts in a microtask before the frame", async () => {
  const [showA, setShowA] = createSignal(false)
  const [showB, setShowB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="ls-root">
        <Show when={showA()}>
          <wardic.div data-a class="ls-twin ls-a" layoutId="handoff" />
        </Show>
        <Show when={showB()}>
          <wardic.div data-b class="ls-twin ls-b" layoutId="handoff" />
        </Show>
      </div>
    </WardicProvider>
  ))
  await raf()
  await scrollWindow(PAGE_SCROLL)
  // A mounts with the page already scrolled.
  setShowA(true)
  await raf()
  await raf()
  const aBox = q(container, "[data-a]").getBoundingClientRect()

  // B registers in this task while A is still live; A leaves before the frame.
  setShowB(true)
  queueMicrotask(() => setShowA(false))
  const first = await paintedNextFrame(() => q(container, "[data-b]"))
  expect(container.querySelector("[data-a]")).toBeNull()
  expectSameCorner(first, aBox)
})

it("window pin: an enterer that mounts a task after the leaver left does not seed from it", async () => {
  const [showA, setShowA] = createSignal(true)
  const [showB, setShowB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div data-root class="ls-root">
        <Show when={showA()}>
          <wardic.div data-a class="ls-twin ls-a" layoutId="expired" />
        </Show>
        <Show when={showB()}>
          <wardic.div data-b class="ls-twin ls-b" layoutId="expired" />
        </Show>
      </div>
    </WardicProvider>
  ))
  await raf()
  await raf()

  setShowA(false)
  const first = await new Promise<DOMRect>((resolve) =>
    setTimeout(() => {
      setShowB(true)
      resolve(paintedNextFrame(() => q(container, "[data-b]")))
    }, 0),
  )
  const b = q(container, "[data-b]")
  const root = q(container, "[data-root]").getBoundingClientRect()
  // B's own layout box (root-relative 200, 1570): the seed expired with A's task.
  expect(Math.abs(first.left - (root.left + 200))).toBeLessThanOrEqual(1)
  expect(Math.abs(first.top - (root.top + 1570))).toBeLessThanOrEqual(1)
  expect(b.style.transform).not.toContain("translate")
})

it("detached leaver: a seed derived after the leaver left the DOM uses its container's LIVE scroll", async () => {
  // The fallback path of the Root-frame capture: the leaver is already detached when
  // its node is disposed, so the seed comes from its last measured box. C1 scrolls
  // AFTER that measure (a scroll triggers no pass), so its last-pass scroll sample is
  // stale; taking the container's share back out at the stale sample would start B
  // 120px off. Split geometry as above, measured at scrollTop 0.
  const [atB, setAtB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="ls-row">
        <wardic.div data-c1 class="ls-sc ls-sc1" layoutScroll>
          <div class="ls-content">
            <Show when={!atB()}>
              <wardic.div data-a class="ls-twin ls-in-a" layoutId="detached" />
            </Show>
          </div>
        </wardic.div>
        <wardic.div data-c2 class="ls-sc ls-sc2" layoutScroll>
          <div class="ls-content">
            <Show when={atB()}>
              <wardic.div data-b class="ls-twin ls-in-b" layoutId="detached" />
            </Show>
          </div>
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  await raf()
  await raf() // A measured with both containers at scrollTop 0
  const c1 = q(container, "[data-c1]")
  const c2 = q(container, "[data-c2]")
  c1.scrollTop = 120
  c2.scrollTop = 40
  expect(c1.scrollTop).toBe(120)
  const a = q(container, "[data-a]")
  const aBox = a.getBoundingClientRect() // where A shows now, 120px up its container

  a.remove() // detach before the swap: A's node is disposed while disconnected
  setAtB(true)
  const first = await paintedNextFrame(() => q(container, "[data-b]"))
  expectSameCorner(first, aBox)
})
