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
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { Reorder, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { commands, page, server } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, raf } from "./browser-helpers.ts"

interface Pt {
  readonly x: number
  readonly y: number
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}
let mouseDown = false
const mouse = {
  move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
  down: async (p: Pt): Promise<void> => {
    await commands.realMouse("down", p.x, p.y)
    mouseDown = true
  },
  up: async (p: Pt): Promise<void> => {
    await commands.realMouse("up", p.x, p.y)
    mouseDown = false
  },
}
const glide = async (from: Pt, to: Pt, steps: number, ms = 20): Promise<void> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps })
    await wait(ms)
  }
}

let width = 0
let height = 0
beforeEach(() => {
  width = window.innerWidth
  height = window.innerHeight
})
afterEach(async () => {
  if (mouseDown) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  window.getSelection()?.removeAllRanges()
  cleanup()
  window.scrollTo(0, 0)
  if (window.innerWidth !== width || window.innerHeight !== height) {
    await page.viewport(width, height)
    await wait(50)
  }
})

const VALUES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"]

interface ListOptions {
  readonly n?: number
  /** Centred in the viewport, so a width change moves it sideways (#39). */
  readonly centred?: boolean
  /** Inside a plain `overflow: auto` container (not `layoutScroll`) this tall. */
  readonly container?: number
  /** A page taller than the viewport. */
  readonly tall?: boolean
  /** Items hold text a drag can select (no app `user-select`). */
  readonly text?: boolean
}

interface List {
  readonly order: () => ReadonlyArray<string>
  readonly item: (value: string) => HTMLElement
  readonly scroller: HTMLElement | undefined
}

const ITEM: JSX.CSSProperties = { width: "200px", height: "50px", "box-sizing": "border-box", border: "1px solid #333", background: "#9cf", "list-style": "none" }

const mountList = async (options: ListOptions = {}): Promise<List> => {
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES.slice(0, options.n ?? 5))
  const [scroller, setScroller] = createSignal<HTMLElement>()
  const groupStyle: JSX.CSSProperties = {
    position: options.container !== undefined ? "relative" : "absolute",
    left: options.container !== undefined ? "0px" : options.centred === true ? "calc(50% - 100px)" : "40px",
    top: options.container !== undefined ? "0px" : "40px",
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
    width: "200px",
    margin: "0",
    padding: "0",
  }
  const group = (): JSX.Element => (
    <Reorder.Group values={order()} onReorder={setOrder} style={groupStyle}>
      <For each={order()}>
        {(value) => (
          <Reorder.Item value={value} data-value={value} style={{ ...ITEM, ...(options.text === true ? { "font-size": "20px" } : {}) }}>
            {options.text === true ? `item ${value} text` : value}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
  render(() => (
    <WardicProvider env={DomLive}>
      {options.container !== undefined ? (
        <div
          ref={(n: HTMLElement) => setScroller(n)}
          style={{ position: "absolute", left: "40px", top: "40px", width: "230px", height: `${options.container}px`, overflow: "auto" }}
        >
          {group()}
        </div>
      ) : options.tall === true ? (
        <div style={{ height: "3000px" }}>{group()}</div>
      ) : (
        group()
      )}
    </WardicProvider>
  ))
  await settle()
  return {
    order,
    item: (value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
    scroller: scroller(),
  }
}

const centreOf = (el: HTMLElement): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}

/** Painted boxes, one read per frame just after its paint, until `stop()`. */
const sampleFrames = <T,>(read: () => T): { readonly stop: () => ReadonlyArray<T> } => {
  const frames: Array<T> = []
  const channel = new MessageChannel()
  let on = true
  channel.port1.onmessage = () => {
    frames.push(read())
    if (on) requestAnimationFrame(() => channel.port2.postMessage(undefined))
  }
  requestAnimationFrame(() => channel.port2.postMessage(undefined))
  return {
    stop: () => {
      on = false
      channel.port1.close()
      return frames
    },
  }
}

/** The largest distance (px, either axis) any of `values` painted from where it was when sampling began. */
const maxDrift = (values: ReadonlyArray<string>, frames: ReadonlyArray<Map<string, DOMRect>>): number => {
  const first = frames[0]!
  let worst = 0
  for (const f of frames) {
    for (const v of values) {
      const a = first.get(v)!
      const b = f.get(v)!
      worst = Math.max(worst, Math.abs(b.left - a.left), Math.abs(b.top - a.top))
    }
  }
  return worst
}
const boxesOf = (list: List, values: ReadonlyArray<string>) => (): Map<string, DOMRect> =>
  new Map(values.map((v) => [v, list.item(v).getBoundingClientRect()]))

/** How far `el` paints from the pointer, relative to where it was grabbed. */
const offPointer = (el: HTMLElement, pointer: Pt, grabOffset: Pt): number => {
  const b = el.getBoundingClientRect()
  return Math.max(Math.abs(b.left - pointer.x - grabOffset.x), Math.abs(b.top - pointer.y - grabOffset.y))
}
const grabOffsetOf = (el: HTMLElement, g: Pt): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left - g.x, y: b.top - g.y }
}

describe("a window width change (#39)", () => {
  it("RE1: after the viewport narrows 200 px, a slow drag of b past c moves no other item, and b stays under the pointer", async () => {
    const list = await mountList({ centred: true })
    await page.viewport(width - 200, height)
    await wait(400)
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    const sampling = sampleFrames(boxesOf(list, ["a", "d", "e"]))
    await mouse.down(g)
    const to = { x: g.x, y: g.y + 46 }
    await glide(g, to, 23)
    await wait(400)
    expect(list.order(), "b crossed c").toEqual(["a", "c", "b", "d", "e"])
    expect(offPointer(b, to, grabOffset), "b under the pointer (was 100 off)").toBeLessThan(1)
    await mouse.up(to)
    await wait(300)
    expect(maxDrift(["a", "d", "e"], sampling.stop()), "uninvolved items (was 97.4)").toBeLessThan(1)
  })

  it("RE2: a grab 50 ms after a width change starts under the pointer", async () => {
    const list = await mountList({ centred: true })
    await page.viewport(width - 200, height)
    await wait(50)
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = { x: g.x, y: g.y + 20 }
    await glide(g, to, 8)
    await settle()
    expect(offPointer(b, to, grabOffset)).toBeLessThan(1)
  })
})

describe("a scroll during a drag", () => {
  it("RE3: the page scrolled 60 px mid-drag keeps b under the pointer", async () => {
    const list = await mountList({ tall: true })
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = { x: g.x, y: g.y + 16 }
    await glide(g, to, 8)
    await wait(200)
    window.scrollBy(0, 60)
    await wait(300)
    expect(offPointer(b, to, grabOffset), "was 60 off").toBeLessThan(1)
  })

  it("RE4: a plain container scrolled 60 px mid-drag keeps b under the pointer", async () => {
    const list = await mountList({ container: 200, n: 8 })
    const b = list.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = { x: g.x, y: g.y + 16 }
    await glide(g, to, 8)
    await wait(200)
    list.scroller!.scrollBy(0, 60)
    await wait(300)
    expect(offPointer(b, to, grabOffset), "was 60 off").toBeLessThan(2)
  })

  it("RE5: a container scrolled 60 px before the drag doesn't leak into the next reorder", async () => {
    const list = await mountList({ container: 200, n: 8 })
    list.scroller!.scrollBy(0, 60)
    await wait(400)
    const d = list.item("d")
    const g = centreOf(d)
    const grabOffset = grabOffsetOf(d, g)
    const sampling = sampleFrames(boxesOf(list, ["a", "b", "c", "f", "g", "h"]))
    await mouse.down(g)
    const to = { x: g.x, y: g.y + 46 }
    await glide(g, to, 23)
    await wait(400)
    expect(list.order(), "d crossed e").toEqual(["a", "b", "c", "e", "d", "f", "g", "h"])
    expect(offPointer(d, to, grabOffset), "d under the pointer (was 58-60 off)").toBeLessThan(2)
    await mouse.up(to)
    await wait(300)
    expect(maxDrift(["a", "b", "c", "f", "g", "h"], sampling.stop()), "uninvolved items (was 58.4)").toBeLessThan(1)
  })
})

describe("Auto-scroll (Motion's, D16)", () => {
  it("RE6: holding an item 15 px from a container's bottom edge scrolls it to its end, with the item under the pointer", async () => {
    const list = await mountList({ container: 300, n: 20 })
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
    const list = await mountList({ n: 20, tall: true })
    const c = list.item("c")
    const g = centreOf(c)
    await mouse.down(g)
    await glide(g, { x: g.x, y: window.innerHeight - 15 }, 20)
    await wait(300)
    expect(window.scrollY).toBeGreaterThan(20)
  })
})

describe.skipIf(server.browser !== "chromium")("touch and text selection (#36, Chromium)", () => {
  it("RE8: a touch drag of b (no app touch-action) reorders it past c", async () => {
    const list = await mountList()
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
    const list = await mountList({ text: true })
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
