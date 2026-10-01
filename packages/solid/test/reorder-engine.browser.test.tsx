// `<Reorder>` through a resize, a scroll, Auto-scroll, touch and text selection
// (ADR-0020), with real Playwright mouse input and, in Chromium, real DevTools touch.
// The cases are the evidence runs' (.tmp/reorder/reorder-run.ts) that bit at 4d2fa2b,
// compared with motion/react 13.4.6's `Reorder` (0 on each):
//
// - #39: after a window width change, the next reorder flew every item from where it
//   was before the resize (97.4 px), and the dragged item sat 100 px off the pointer.
// - A page or container scroll mid-drag left the dragged item the scrolled 60 px off
//   the pointer; a container scrolled before the drag leaked 58.4 px into the next
//   reorder's animation.
// - Motion's Auto-scroll: holding the item near a scroller's edge scrolls it.
// - #36: a touch drag was cancelled after its first moves, and in Chromium a second
//   drag starting on text the first one selected was cancelled by a native drag.
//
// The list: 5 values a..e in a flex column (200x50 items, 10 px gap, so a 60 px pitch).
// A drag grabs an item at its centre. Frames are read post-paint; "under the pointer"
// is read after the pointer has held still for a few frames, so the known one-frame lag
// of a move (#32) doesn't enter it.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { commands, page, server } from "vitest/browser"
import { raf } from "./browser-helpers.ts"
import {
  add,
  centreOf,
  type Frame,
  glide,
  grabOffsetOf,
  mouse,
  mountReorder,
  offPointer,
  resetScene,
  sampleFrames,
  type Scene,
  settle,
  wait,
} from "./reorder-harness.tsx"

let width = 0
let height = 0
beforeEach(() => {
  width = window.innerWidth
  height = window.innerHeight
})
afterEach(async () => {
  await resetScene()
  if (window.innerWidth !== width || window.innerHeight !== height) {
    await page.viewport(width, height)
    await wait(50)
  }
})

/** The largest distance (px, either axis) any of `values` painted from where it was when sampling began. */
const maxDrift = (frames: ReadonlyArray<Frame<Map<string, DOMRect>>>, values: ReadonlyArray<string>): number => {
  const first = frames[0]!.v
  let worst = 0
  for (const f of frames) {
    for (const v of values) {
      const a = first.get(v)!
      const b = f.v.get(v)!
      worst = Math.max(worst, Math.abs(b.left - a.left), Math.abs(b.top - a.top))
    }
  }
  return worst
}
const boxesOf = (s: Scene, values: ReadonlyArray<string>) => (): Map<string, DOMRect> =>
  new Map(values.map((v) => [v, s.item(v).getBoundingClientRect()]))

describe("a window width change (#39)", () => {
  it("RE1: after the viewport narrows 200 px, a slow drag of b past c moves no other item, and b stays under the pointer", async () => {
    const list = await mountReorder({ centred: true })
    await page.viewport(width - 200, height)
    await wait(400)
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    const sampling = sampleFrames(boxesOf(list, ["a", "d", "e"]))
    await mouse.down(g)
    const to = add(g, 0, 46)
    await glide(g, to, 23)
    await wait(400)
    expect(list.order(), "b crossed c").toEqual(["a", "c", "b", "d", "e"])
    expect(offPointer(b, to, grabOffset), "b under the pointer (was 100 off)").toBeLessThan(1)
    await mouse.up(to)
    await wait(300)
    expect(maxDrift(sampling.stop(), ["a", "d", "e"]), "uninvolved items (was 97.4)").toBeLessThan(1)
  })

  it("RE2: a grab 50 ms after a width change starts under the pointer", async () => {
    const list = await mountReorder({ centred: true })
    await page.viewport(width - 200, height)
    await wait(50)
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = add(g, 0, 20)
    await glide(g, to, 8)
    await settle()
    expect(offPointer(b, to, grabOffset)).toBeLessThan(1)
  })
})

describe("a scroll during a drag", () => {
  it("RE3: the page scrolled 60 px mid-drag keeps b under the pointer", async () => {
    const list = await mountReorder({ tall: true })
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = add(g, 0, 16)
    await glide(g, to, 8)
    await wait(200)
    window.scrollBy(0, 60)
    await wait(300)
    expect(offPointer(b, to, grabOffset), "was 60 off").toBeLessThan(1)
  })

  it("RE4: a plain container scrolled 60 px mid-drag keeps b under the pointer", async () => {
    const list = await mountReorder({ container: 200, n: 8 })
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = add(g, 0, 16)
    await glide(g, to, 8)
    await wait(200)
    list.scroller!.scrollBy(0, 60)
    await wait(300)
    expect(offPointer(b, to, grabOffset), "was 60 off").toBeLessThan(2)
  })

  it("RE5: a container scrolled 60 px before the drag doesn't leak into the next reorder", async () => {
    const list = await mountReorder({ container: 200, n: 8 })
    list.scroller!.scrollBy(0, 60)
    await wait(400)
    // c (100-150 in the viewport once scrolled) is dragged 46 px down past d, its pointer
    // staying more than 50 px from both container edges, so Auto-scroll doesn't join in.
    const c = list.item("c")
    const g = centreOf(c)
    const grabOffset = grabOffsetOf(c, g)
    const sampling = sampleFrames(boxesOf(list, ["a", "b", "e", "f", "g", "h"]))
    await mouse.down(g)
    const to = add(g, 0, 46)
    await glide(g, to, 23)
    await wait(400)
    expect(list.order(), "c crossed d").toEqual(["a", "b", "d", "c", "e", "f", "g", "h"])
    expect(offPointer(c, to, grabOffset), "c under the pointer (was 58-60 off)").toBeLessThan(2)
    await mouse.up(to)
    await wait(300)
    expect(maxDrift(sampling.stop(), ["a", "b", "e", "f", "g", "h"]), "uninvolved items (was 58.4)").toBeLessThan(1)
  })
})

describe("Auto-scroll (Motion's, D16)", () => {
  it("RE6: holding an item 15 px from a container's bottom edge scrolls it to its end, with the item under the pointer", async () => {
    const list = await mountReorder({ container: 300, n: 20 })
    const sc = list.scroller!
    const max = sc.scrollHeight - sc.clientHeight
    const c = list.item("c")
    const g = centreOf(c)
    const grabOffset = grabOffsetOf(c, g)
    const edge = sc.getBoundingClientRect().bottom
    await mouse.down(g)
    const to = { x: g.x, y: edge - 15 }
    await glide(g, to, 20)
    const atHold = sc.scrollTop
    await wait(300)
    expect(sc.scrollTop, "keeps scrolling while the pointer holds still").toBeGreaterThan(atHold + 20)
    const start = performance.now()
    while (sc.scrollTop < max && performance.now() - start < 4000) await raf()
    expect(sc.scrollTop, "reaches the range it had at the start").toBeCloseTo(max, 0)
    await settle()
    expect(offPointer(c, to, grabOffset), "the item under the pointer").toBeLessThan(2)
  })

  it("RE7: a group in the page scrolls the document near the viewport's bottom edge", async () => {
    const list = await mountReorder({ n: 20, tall: true })
    const c = list.item("c")
    const g = centreOf(c)
    await mouse.down(g)
    await glide(g, { x: g.x, y: window.innerHeight - 15 }, 20)
    await wait(300)
    expect(window.scrollY).toBeGreaterThan(20)
  })

  it("RE10: an item removed mid-gesture ends its Auto-scroll: the next drag in the edge zone, moving away from the edge, doesn't scroll", async () => {
    const list = await mountReorder({ container: 300, n: 20 })
    const sc = list.scroller!
    const g = centreOf(list.item("c"))
    const edge = sc.getBoundingClientRect().bottom
    await mouse.down(g)
    await glide(g, { x: g.x, y: edge - 15 }, 20)
    await wait(150)
    expect(sc.scrollTop, "the end edge is scrolling").toBeGreaterThan(20)
    // The app removes the dragged item while it's held.
    list.setOrder(list.order().filter((v) => v !== "c"))
    await settle()
    await mouse.up({ x: g.x, y: edge - 15 })
    sc.scrollTop = 200
    await settle()
    // Press an item 14-38 px above the bottom edge and move up 10 px on it: still in the
    // zone, moving toward the start, so no edge may start.
    const itemAt = (y: number) => document.elementFromPoint(g.x, y)?.closest<HTMLElement>("[data-value]") ?? null
    let at: { x: number; y: number } | undefined
    for (let y = edge - 14; y >= edge - 38 && at === undefined; y--) {
      const hit = itemAt(y)
      if (hit !== null && itemAt(y - 10) === hit) at = { x: g.x, y }
    }
    expect(at, "an item in the edge zone").toBeDefined()
    const before = sc.scrollTop
    await mouse.down(at!)
    await glide(at!, add(at!, 0, -10), 5)
    await wait(150)
    expect(sc.scrollTop).toBe(before)
    await mouse.up(add(at!, 0, -10))
  })
})

describe.skipIf(server.browser !== "chromium")("touch and text selection (#36, Chromium)", () => {
  it("RE8: a touch drag of b (no app touch-action) reorders it past c", async () => {
    const list = await mountReorder()
    // Chromium swallows the first touch after an earlier touch gesture: tap off the list first.
    await commands.realTouch("touchStart", [{ x: 380, y: 800, id: 1 }])
    await commands.realTouch("touchEnd", [])
    await wait(100)
    const g = centreOf(list.item("b"))
    await commands.realTouch("touchStart", [{ ...g, id: 1 }])
    for (let k = 1; k <= 23; k++) {
      await commands.realTouch("touchMove", [{ x: g.x, y: g.y + 2 * k, id: 1 }])
      await wait(20)
    }
    await wait(200)
    await commands.realTouch("touchEnd", [])
    await settle()
    expect(list.order(), "was cancelled after 8 moves").toEqual(["a", "c", "b", "d", "e"])
  })

  it("RE9: after a first drag across b's text, a second drag starting on it reorders again", async () => {
    const list = await mountReorder({ text: true })
    const g = centreOf(list.item("b"))
    await mouse.down(g)
    await glide(g, { x: g.x + 40, y: g.y + 46 }, 23)
    await wait(200)
    await mouse.up({ x: g.x + 40, y: g.y + 46 })
    await wait(900)
    expect(list.order()).toEqual(["a", "c", "b", "d", "e"])
    const g2 = centreOf(list.item("b"))
    await mouse.down(g2)
    await glide(g2, { x: g2.x, y: g2.y + 46 }, 23)
    await wait(200)
    await mouse.up({ x: g2.x, y: g2.y + 46 })
    await settle()
    expect(list.order(), "the second drag wasn't cancelled").toEqual(["a", "c", "d", "b", "e"])
  })
})
