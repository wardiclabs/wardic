// A layout drag's release through the drag track (ADR-0016, *Amendment (velocity family)*: #28,
// #30, #34, #38, #88): DR2–DR4 with real Playwright mouse input, DR1 with pushed input whose
// timestamps it sets, since its claim rests on the gesture's speed (#206).
//
// The track hands the release the gesture's velocity over its last 100 ms (Motion's
// `getVelocity`), none with `dragMomentum={false}`. A press on the element stops a running
// release where it is, and one that ends with no drag lets it go on from rest (Motion's
// `stopAnimation` at the press and `resumeAnimation`). A `<Reorder>` item under the pointer
// paints above one still flying back (`z-index` 2 against 1).
//
// The engine's own rules (the offset, a slot move under it, a grab mid-flight, the
// crossfade) are pinned against a fake sink in @wardic/dom's
// projection-release.browser.test.ts; these are what only the real track and real paint show.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import { loseNextRelease, raf } from "./browser-helpers.ts"
import { pushedPointer } from "./pushed-pointer.ts"
import { add, centreOf, glide, mountReorder, mouse, type Pt, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

/** A 120x80 `layout drag` box at (40, 40), free on both axes, on `env`. */
const mountBox = async (momentum: boolean, env: WardicEnv = DomLive): Promise<{ readonly el: HTMLElement; readonly slot: DOMRect }> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={env}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          layout
          drag
          dragMomentum={momentum}
          style={{ position: "relative", width: "120px", height: "80px", background: "#f88" }}
        />
      </div>
    </WardicProvider>
  ))
  await settle()
  const target = el()!
  return { el: target, slot: target.getBoundingClientRect() }
}

/** How far right of its slot the box paints. */
const dxOf = (s: { readonly el: HTMLElement; readonly slot: DOMRect }): number => s.el.getBoundingClientRect().left - s.slot.left

describe("a layout drag's release through the drag track (ADR-0016, Amendment (velocity family))", () => {
  it("DR1: a flick back toward the slot carries the release past it, at the velocity of the last 100 ms; with dragMomentum={false} it never crosses", async () => {
    const lows: Array<number> = []
    for (const momentum of [true, false]) {
      // Pushed input with the gesture's own timestamps, so the release's velocity is the same on
      // any host, however late the events arrive (#206). The track, the projection and the paint
      // are the real ones.
      const pointer = pushedPointer()
      const s = await mountBox(momentum, pointer.env)
      pointer.push("down", 0, 0)
      // Out 220 px, 20 ms apart, each move painted.
      for (let k = 1; k <= 11; k++) {
        pointer.push("move", 20 * k, 20)
        await raf()
      }
      // Back toward the slot fast: 50 px moves 35 ms apart, let go 5 ms after the last, 20 px short
      // of it. The window starts at the newest point more than 100 ms before the release, the first
      // move back: (20 - 170) px over 110 ms, about -1,360 px/s.
      for (let k = 1; k <= 4; k++) {
        pointer.push("move", 220 - 50 * k, 35)
        await raf()
      }
      const sampling = sampleFrames(() => dxOf(s))
      pointer.push("up", 20, 5)
      await wait(400)
      const frames = sampling.stop()
      lows.push(Math.min(...frames.map((f) => f.v)))
      await commands.report(`DR1 momentum=${momentum} low=${lows.at(-1)!.toFixed(2)} over ${frames.length} frames`)
      await wait(600)
      expect(Math.abs(dxOf(s)), "it lands on its slot").toBeLessThan(0.5)
      await resetScene()
    }
    const [flick, still] = lows
    // This gesture carries the box 14 px past its slot: the bar is half that, so a release that
    // loses most of its velocity fails too.
    expect(flick, `with momentum it reached ${flick} px: past its slot`).toBeLessThan(-7)
    expect(still, `with dragMomentum={false} it reached ${still} px`).toBeGreaterThan(-0.5)
  })

  it("DR2: a press mid-release holds the box where it is; letting go with no drag lets the release go on, to its slot", async () => {
    const s = await mountBox(false)
    const g: Pt = { x: s.slot.left + 20, y: s.slot.top + 40 }
    await mouse.down(g)
    await glide(g, add(g, 150, 0), 10, 20)
    await wait(100)
    await mouse.up(add(g, 150, 0))
    await wait(120)
    const flying = dxOf(s)
    expect(flying, "mid-release").toBeGreaterThan(20)
    expect(flying).toBeLessThan(140)
    // Press on the box where it paints, and hold still.
    const box = s.el.getBoundingClientRect()
    const press: Pt = { x: box.left + 20, y: box.top + 40 }
    await mouse.down(press)
    const sampling = sampleFrames(() => dxOf(s))
    await wait(250)
    const held = sampling.stop().map((f) => f.v)
    expect(held.length).toBeGreaterThan(5)
    const spread = Math.max(...held) - Math.min(...held)
    expect(spread, `it moved ${spread} px while pressed`).toBeLessThan(0.5)
    await mouse.up(press)
    await wait(900)
    expect(Math.abs(dxOf(s)), "the release went on, to its slot").toBeLessThan(0.5)
  })

  it("DR4: a press mid-release whose release is lost lets the release go on at the pointer's first unpressed move", async () => {
    const s = await mountBox(false)
    const g: Pt = { x: s.slot.left + 20, y: s.slot.top + 40 }
    await mouse.down(g)
    await glide(g, add(g, 150, 0), 10, 20)
    await wait(100)
    await mouse.up(add(g, 150, 0))
    await wait(120)
    const box = s.el.getBoundingClientRect()
    const press: Pt = { x: box.left + 20, y: box.top + 40 }
    // Before the press, so it runs ahead of the listeners the press adds.
    loseNextRelease()
    await mouse.down(press)
    await mouse.up(press)
    await wait(150)
    const held = dxOf(s)
    expect(held, "held where the press stopped it").toBeGreaterThan(20)
    await wait(100)
    expect(Math.abs(dxOf(s) - held), "still held: the page never heard the release").toBeLessThan(0.5)
    // The first move with no button pressed ends the press (ADR-0019), and the release goes on.
    await mouse.move(add(press, 0, 120))
    await wait(900)
    expect(Math.abs(dxOf(s)), "it went on to its slot").toBeLessThan(0.5)
  })

  it("DR3: an item re-grabbed while the last one flies back paints above it on every frame (#88)", async () => {
    const s = await mountReorder()
    const a = s.item("a")
    const ga = centreOf(a)
    await mouse.down(ga)
    await glide(ga, add(ga, 0, 300), 15, 20)
    await wait(50)
    await mouse.up(add(ga, 0, 300))
    await wait(120)
    // `a` flies back up to the last slot; grab `e`, just above it, near its bottom edge, and
    // drag it 25 px down: the pointer ends where `e` and `a`'s slot overlap.
    const e = s.item("e")
    const eb = e.getBoundingClientRect()
    const ge: Pt = { x: eb.left + eb.width / 2, y: eb.top + 45 }
    await mouse.down(ge)
    const to = add(ge, 0, 25)
    await glide(ge, to, 5, 20)
    // Read once the pointer holds still, so a move's one-frame lag (#32) doesn't enter it.
    await wait(40)
    const covers = (el: Element): boolean => {
      const b = el.getBoundingClientRect()
      return to.x >= b.left && to.x <= b.right && to.y >= b.top && to.y <= b.bottom
    }
    const sampling = sampleFrames(() => {
      const hit = document.elementFromPoint(to.x, to.y)
      return { onTop: hit !== null && (hit === e || e.contains(hit)), overlap: covers(a) && covers(e) }
    })
    await wait(500)
    const frames = sampling.stop()
    await mouse.up(to)
    const overlapping = frames.filter((f) => f.v.overlap)
    expect(overlapping.length, "a flies in under the pointer while e is held").toBeGreaterThan(5)
    const under = frames.filter((f) => !f.v.onTop).length
    expect(under, `frames with e under another item, of ${frames.length}`).toBe(0)
    await wait(900)
    expect(e.style.getPropertyValue("z-index"), "no inline z-index at rest").toBe("")
    expect(a.style.getPropertyValue("z-index")).toBe("")
  })
})
