// A layout node animating its own size (#453): its new size is its own, no layout change, as Motion's
// projection never sees one (it measures at a re-render, not on a resize). Before, each frame's resize
// queued a Measure pass that animated the node from its box before: style 200px, painted 78.5px.
//
// - OS1: a `layout` element's own height leg is drawn as it goes: its painted box is its style's
//   height every frame, with no scale.
// - OS2: a `layout` sibling the leg moves goes with the flow: it never takes a transform.
// - OS3: beside a real resize in the same delivery (another layout node's content grows in a frame the
//   leg draws), the own-sized node still draws its height, and the other animates its growth.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { resetScene, settle } from "./reorder-harness.tsx"

afterEach(resetScene)

const LINEAR = { type: "tween", duration: 0.5, ease: "linear" } as const
const PANEL = { width: "80px", background: "teal", "margin-left": "120px" } as const

/** `el`'s painted height, and its inline one. */
const heights = (el: HTMLElement): { readonly painted: number; readonly style: number } => ({
  painted: el.getBoundingClientRect().height,
  style: Number.parseFloat(el.style.height),
})

/** `el`'s computed transform as a matrix, identity for `none`. */
const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))

describe("a layout node animating its own size (#453)", () => {
  it("OS1: a layout element's own height leg is drawn as it goes, with no scale", async () => {
    const [h, setH] = createSignal("40px")
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} layout style={{ ...PANEL, "margin-top": "120px" }} initial={{ height: "40px" }} animate={{ height: h() }} transition={LINEAR} />
      </WardicProvider>
    ))
    await settle()
    setH("200px")
    const off: Array<string> = []
    for (let i = 0; i < 45; i++) {
      await raf()
      const { painted, style } = heights(el)
      const scale = matrixOf(el).m22
      if (Math.abs(painted - style) > 0.5 || Math.abs(scale - 1) > 1e-6) off.push(`${i}: style ${style}, painted ${painted.toFixed(1)}, scale ${scale}`)
    }
    expect(off, "painted as drawn, every frame").toEqual([])
    expect(heights(el).painted).toBeCloseTo(200, 1)
  })

  it("OS2: a layout sibling the leg moves goes with the flow, never transformed", async () => {
    const [h, setH] = createSignal("40px")
    let sibling!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div layout style={{ ...PANEL, "margin-top": "120px" }} initial={{ height: "40px" }} animate={{ height: h() }} transition={LINEAR} />
        <wardic.div ref={(n: HTMLElement) => (sibling = n)} layout style={{ ...PANEL, height: "40px" }} />
      </WardicProvider>
    ))
    await settle()
    const top = sibling.getBoundingClientRect().top
    setH("200px")
    const moved: Array<string> = []
    for (let i = 0; i < 45; i++) {
      await raf()
      const m = matrixOf(sibling)
      if (Math.abs(m.m42) > 1e-6 || Math.abs(m.m22 - 1) > 1e-6) moved.push(`${i}: ${getComputedStyle(sibling).transform}`)
    }
    expect(moved, "no layout animation of its own").toEqual([])
    expect(sibling.getBoundingClientRect().top - top, "pushed down by the leg").toBeCloseTo(160, 0)
  })

  it("OS3: beside a real resize in the same frame, the own-sized node draws its height and the other animates", async () => {
    const [h, setH] = createSignal("40px")
    const [lines, setLines] = createSignal<ReadonlyArray<number>>([0])
    let own!: HTMLElement
    let grown!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (own = n)} layout style={{ ...PANEL, "margin-top": "120px" }} initial={{ height: "40px" }} animate={{ height: h() }} transition={LINEAR} />
        <wardic.div ref={(n: HTMLElement) => (grown = n)} layout style={{ ...PANEL, "margin-left": "260px", "line-height": "20px" }}>
          <For each={lines()}>{(n) => <div>line {n}</div>}</For>
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    setH("200px")
    // The growth in a frame the leg draws, so one delivery reports both resizes.
    for (let i = 0; i < 5; i++) await raf()
    expect(heights(own).style, "the leg is drawing").toBeGreaterThan(40)
    setLines([0, 1, 2, 3, 4, 5])
    const off: Array<string> = []
    let scaled = false
    for (let i = 0; i < 30; i++) {
      await raf()
      const { painted, style } = heights(own)
      if (Math.abs(painted - style) > 0.5) off.push(`${i}: style ${style}, painted ${painted.toFixed(1)}`)
      if (Math.abs(matrixOf(grown).m22 - 1) > 0.01) scaled = true
    }
    expect(off, "the own-sized node painted as drawn").toEqual([])
    expect(scaled, "the grown node's real resize animates").toBe(true)
  })
})
