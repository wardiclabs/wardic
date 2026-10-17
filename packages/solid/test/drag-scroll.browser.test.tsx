// A scroll during a drag keeps the dragged element under the pointer (ADR-0019
// *Amendment (Reorder)*, ADR-0012 *Amendment (Reorder)*). Real Playwright mouse input.
//
// Motion's pan session treats a scroll of the page or of a scrolling ancestor while the
// pointer is held as a move by the scrolled distance (PanSession.ts:176-263 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8), so the element stays under the pointer.
// Since the fix, Wardic's Held pointer does the same: a scroll becomes a synthetic move,
// and a layout drag's Measure pass folds every scrolled ancestor out of its boxes. Before,
// the element moved with the scrolled content and ended the scrolled distance off the
// pointer (60 px in the evidence runs; motion/react 13.4.6: 0).
//
// "Under the pointer" is read after the scroll has painted: the element's box minus the
// pointer is the grab-time box minus the grab point, within 1 px (2 px where a Measure
// pass re-reads the slot in a scrolled container). The reads wait whole frames after the
// last input, so the known one-frame lag of a move (#32) doesn't enter them.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { LayoutGroup, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
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

afterEach(async () => {
  if (mouseDown) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  cleanup()
  window.scrollTo(0, 0)
})

const BOX = { position: "relative", width: "120px", height: "80px", background: "#f88", "user-select": "none" } as const

interface Scene {
  readonly el: HTMLElement
  readonly scroller: HTMLElement | undefined
  /** Grows the layout sibling above D by 20 px (a slot move for D: a Measure pass). */
  readonly bump: () => void
}

/**
 * D (120x80) on a 3000 px tall page, or inside a plain `overflow: auto` container
 * (200 px tall, 1000 px of content, not `layoutScroll`). A `layout` D sits in a
 * `LayoutGroup` under a 40 px `layout` sibling S.
 */
const mount = async (mode: "free" | "layout", where: "page" | "container"): Promise<Scene> => {
  const [el, setEl] = createSignal<HTMLElement>()
  const [scroller, setScroller] = createSignal<HTMLElement>()
  const [grown, setGrown] = createSignal(0)
  const d = (): JSX.Element => (
    <wardic.div ref={(n: HTMLElement) => setEl(n)} layout={mode === "layout"} drag dragMomentum={false} style={BOX} />
  )
  const column = (): JSX.Element =>
    Bool.match(mode === "layout", {
      onTrue: () => (
        <LayoutGroup>
          <wardic.div layout style={{ height: `${40 + grown()}px`, width: "120px", background: "#8f8" }} />
          {d()}
        </LayoutGroup>
      ),
      onFalse: () => d(),
    })
  render(() => (
    <WardicProvider env={DomLive}>
      {Bool.match(where === "page", {
        onTrue: () => <div style={{ position: "absolute", top: "40px", left: "40px", height: "3000px" }}>{column()}</div>,
        onFalse: () => (
          <div
            ref={(n: HTMLElement) => setScroller(n)}
            style={{ position: "absolute", top: "40px", left: "40px", width: "220px", height: "200px", overflow: "auto" }}
          >
            <div style={{ height: "1000px" }}>{column()}</div>
          </div>
        ),
      })}
    </WardicProvider>
  ))
  await settle()
  return { el: el()!, scroller: scroller(), bump: () => setGrown((g) => g + 20) }
}

/** Grab D 20 px in from its left edge at its vertical centre and move 20 px down. */
const grabAndMove = async (s: Scene): Promise<{ readonly pointer: Pt; readonly grabOffset: Pt }> => {
  const box = s.el.getBoundingClientRect()
  const g = { x: box.left + 20, y: box.top + 40 }
  await mouse.down(g)
  const pointer = { x: g.x, y: g.y + 20 }
  await glide(g, pointer, 8)
  await wait(100)
  return { pointer, grabOffset: { x: box.left - g.x, y: box.top - g.y } }
}

/** How far D paints from where the pointer holds it, after a few frames. */
const offPointer = async (s: Scene, pointer: Pt, grabOffset: Pt): Promise<Pt> => {
  await settle()
  const b = s.el.getBoundingClientRect()
  return { x: b.left - pointer.x - grabOffset.x, y: b.top - pointer.y - grabOffset.y }
}

describe("a scroll during a drag keeps the element under the pointer", () => {
  it("DS1: a free drag, the page scrolled 60 px mid-drag", async () => {
    const s = await mount("free", "page")
    const { pointer, grabOffset } = await grabAndMove(s)
    window.scrollBy(0, 60)
    const off = await offPointer(s, pointer, grabOffset)
    expect(Math.abs(off.x), "x").toBeLessThan(1)
    expect(Math.abs(off.y), "y (was 60 off)").toBeLessThan(1)
  })

  it("DS2: a free drag in a plain overflow:auto container scrolled 60 px mid-drag", async () => {
    const s = await mount("free", "container")
    const { pointer, grabOffset } = await grabAndMove(s)
    s.scroller!.scrollBy(0, 60)
    const off = await offPointer(s, pointer, grabOffset)
    expect(Math.abs(off.x), "x").toBeLessThan(1)
    expect(Math.abs(off.y), "y").toBeLessThan(1)
  })

  it("DS3: a layout drag (ADR-0016), the page scrolled 60 px mid-drag", async () => {
    const s = await mount("layout", "page")
    const { pointer, grabOffset } = await grabAndMove(s)
    window.scrollBy(0, 60)
    const off = await offPointer(s, pointer, grabOffset)
    expect(Math.abs(off.x), "x").toBeLessThan(1)
    expect(Math.abs(off.y), "y").toBeLessThan(1)
  })

  // The pass after the scroll re-reads the dragged node's slot. Before the fix it read it
  // in viewport coordinates (no fold), which put the node back under the pointer by
  // accident; with the scroll a synthetic move (D14), the pass must fold the container's
  // scroll out (D15) or it counts the 60 px twice.
  it("DS4: a layout drag in a plain container scrolled 60 px mid-drag, then a Measure pass (its slot moves 20 px)", async () => {
    const s = await mount("layout", "container")
    const { pointer, grabOffset } = await grabAndMove(s)
    s.scroller!.scrollBy(0, 60)
    const scrolled = await offPointer(s, pointer, grabOffset)
    expect(Math.abs(scrolled.y), "y after the scroll").toBeLessThan(1)
    s.bump()
    const off = await offPointer(s, pointer, grabOffset)
    expect(Math.abs(off.x), "x after the pass").toBeLessThan(2)
    expect(Math.abs(off.y), "y after the pass").toBeLessThan(2)
  })
})
