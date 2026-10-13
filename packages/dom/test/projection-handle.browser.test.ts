// The projection handle reports its node's geometry, and a dragged node can be raised
// (ADR-0016, *Amendment (Reorder)*), checked against a fake ProjectionSink with every
// Refresh frame fired by hand.
//
// `layoutBox()` is the slot in the Scroll-stable frame, `dragOffset()` the painted box
// minus the slot while dragged, `layoutVersion()` a counter a Measure pass bumps. They
// are plain reads. `raiseWhileDragged` makes the engine carry a raise inside the node's
// `@projection` value from the drag's start until its release settles, then write one
// last value without it; the renderer's pure `project` turns the raise into `z-index`.
import * as Projection from "@wardic/core/Projection"
import * as Renderer from "@wardic/core/Renderer"
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"
import { clearStages, el, endOfTask, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)
afterEach(() => {
  unstubFrames()
  clearStages()
  window.scrollTo(0, 0)
})

const IDENTITY: Projection.Delta = {
  x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
}

describe("the projection handle's getters and the raise (ADR-0016, Amendment (Reorder))", () => {
  it("PH1: layoutBox() is undefined before the first pass, then the slot in the Scroll-stable frame", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage("position:relative;width:400px;height:3000px")
    const box = el(root, "position:absolute;left:10px;top:200px;width:100px;height:50px")
    window.scrollTo(0, 100)
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}) })
    expect(h.layoutBox()).toBeUndefined()
    await endOfTask()
    const r = box.getBoundingClientRect()
    const b = h.layoutBox()!
    // The viewport box plus the page's scroll.
    expect(b.x.min).toBeCloseTo(r.left, 1)
    expect(b.y.min).toBeCloseTo(r.top + 100, 1)
    expect(b.x.max - b.x.min).toBeCloseTo(100, 1)
    expect(b.y.max - b.y.min).toBeCloseTo(50, 1)
    e.dispose()
  })

  it("PH2: layoutVersion() is 0 until measured and rises with every pass that measures the node, a drag-blocked one included", async () => {
    const e = makeEngine(makeSink().sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}) })
    expect(h.layoutVersion()).toBe(0)
    await endOfTask()
    expect(h.layoutVersion()).toBe(1)
    h.notify()
    await endOfTask()
    expect(h.layoutVersion()).toBe(2)
    h.dragStart()
    h.notify()
    await endOfTask()
    expect(h.layoutVersion()).toBe(3)
    e.dispose()
  })

  it("PH3: dragOffset() is 0 at rest, and while dragged the painted box minus the latest slot", async () => {
    const e = makeEngine(makeSink().sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}) })
    await endOfTask()
    fireFrame()
    expect(h.dragOffset()).toEqual({ x: 0, y: 0 })
    h.dragStart()
    h.dragMove({ x: 30, y: 40 })
    expect(h.dragOffset()).toEqual({ x: 30, y: 40 })
    // The slot moves 60 px down under the held item: it still paints at grab + (30, 40).
    box.style.top = "60px"
    h.notify()
    await endOfTask()
    const off = h.dragOffset()
    expect(off.x).toBeCloseTo(30, 6)
    expect(off.y).toBeCloseTo(-20, 6)
    e.dispose()
  })

  it("PH4: dragOffset() is 0 again once released, during the flight back", async () => {
    const e = makeEngine(makeSink().sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}) })
    await endOfTask()
    fireFrame()
    h.dragStart()
    h.dragMove({ x: 80, y: 0 })
    h.dragEnd()
    fireFrame()
    expect(h.dragOffset()).toEqual({ x: 0, y: 0 })
    e.dispose()
  })

  it("PH5: with raiseWhileDragged, every write from the drag's start through the flight back carries the raise (2 while dragged, 1 once released), and one write after the settle drops it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}), raiseWhileDragged: true })
    await endOfTask()
    fireFrame()
    const from = sk.of("a").length
    h.dragStart()
    h.dragMove({ x: 80, y: 0 })
    fireFrame()
    const released = sk.of("a").length
    h.dragEnd()
    await endOfTask()
    fireFrames(240)
    const after = sk.of("a").slice(from)
    expect(after.length).toBeGreaterThan(3)
    // 2 while dragged (ADR-0016, Amendment (velocity family), decision 6).
    const dragged = sk.of("a").slice(from, released).map((w) => w.value.raise)
    expect(dragged.length).toBeGreaterThan(0)
    expect(dragged.every((r) => r === 2)).toBe(true)
    // 1 on every write of the flight back but the very last, which is the reset.
    const back = sk.of("a").slice(released).map((w) => w.value.raise)
    expect(back.length).toBeGreaterThan(2)
    expect(back.slice(0, -1).every((r) => r === 1)).toBe(true)
    expect(back.at(-1)).toBeUndefined()
    // Nothing is written after the reset.
    fireFrames(30)
    expect(sk.of("a").slice(from)).toHaveLength(after.length)
    e.dispose()
  })

  it("PH6: the renderer's project emits z-index only while the projection value carries a raise", async () => {
    const e = makeEngine(makeSink().sink)
    const renderer = e.runtime.runSync(Renderer.Renderer)
    const raised = renderer.project({ [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 }, raise: 1 } })
    expect(raised["z-index"]).toBe(1)
    const plain = renderer.project({ [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 } } })
    expect("z-index" in plain).toBe(false)
    e.dispose()
  })

  it("PH7: without raiseWhileDragged no write carries a raise", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}) })
    await endOfTask()
    fireFrame()
    h.dragStart()
    h.dragMove({ x: 80, y: 0 })
    h.dragEnd()
    await endOfTask()
    fireFrames(240)
    expect(sk.of("a").some((w) => "raise" in w.value)).toBe(false)
    e.dispose()
  })

  it("PH8: a release in place drops the raise at once", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}), raiseWhileDragged: true })
    await endOfTask()
    fireFrame()
    h.dragStart()
    h.dragMove({ x: 20, y: 0 })
    expect(sk.of("a").at(-1)?.value.raise).toBe(2)
    h.dragMove({ x: 0, y: 0 })
    h.dragEnd()
    expect(sk.of("a").at(-1)?.value.raise).toBeUndefined()
    e.dispose()
  })

  it("PH10: a released layoutRoot's Release offset goes on through a Measure pass (its self-snap), raised, and its settle drops the raise", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}), raiseWhileDragged: true, layoutRoot: true })
    await endOfTask()
    fireFrame()
    h.dragStart()
    h.dragMove({ x: 80, y: 0 })
    fireFrame()
    h.dragEnd()
    await endOfTask()
    fireFrames(3)
    expect(sk.of("a").at(-1)?.value.raise).toBe(1)
    const before = sk.of("a").at(-1)?.tx ?? 0
    expect(before).toBeGreaterThan(10)
    // A pass mid-flight: a layoutRoot snaps its own layout, but its Release offset isn't a
    // layout animation, so the flight back goes on (ADR-0016, Amendment (velocity family)).
    h.notify()
    await endOfTask()
    expect(sk.of("a").at(-1)?.value.raise).toBe(1)
    expect(sk.of("a").at(-1)?.tx).toBeCloseTo(before, 1)
    fireFrame()
    const next = sk.of("a").at(-1)?.tx ?? 0
    expect(next).toBeLessThan(before)
    expect(next).toBeGreaterThan(0)
    fireFrames(240)
    expect(sk.of("a").at(-1)?.value.raise).toBeUndefined()
    expect(sk.of("a").at(-1)?.tx).toBeCloseTo(0, 5)
    e.dispose()
  })

  it("PH9: the getters are plain reads: no layout read, no pass", async () => {
    const e = makeEngine(makeSink().sink)
    const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: box, springOptions: () => ({}) })
    await endOfTask()
    h.dragStart()
    h.dragMove({ x: 10, y: 0 })
    const spans = e.spans.length
    const reads = vi.spyOn(Element.prototype, "getBoundingClientRect")
    try {
      for (let i = 0; i < 100; i++) {
        h.layoutBox()
        h.dragOffset()
        h.layoutVersion()
      }
      expect(reads).not.toHaveBeenCalled()
    } finally {
      reads.mockRestore()
    }
    await endOfTask()
    expect(e.spans).toHaveLength(spans)
    e.dispose()
  })
})
