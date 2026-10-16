// Every scrollable ancestor is folded (ADR-0012, *Amendment (Reorder)*), checked against
// a fake ProjectionSink with every Refresh frame fired by hand.
//
// A plain scroll container (an element with overflow neither visible nor clip, not a
// `layoutScroll` node) used to leak its scroll into every box inside it: the next Measure
// pass compared against boxes measured before the scroll and seeded them all. Now its
// scroll is sampled in the pass's read phase and folded out, as a `layoutScroll`
// container's is, so a scroll between passes never reaches a box. A `position: fixed`
// element stops the fold, as a fixed `layoutScroll` root does.
//
// Deterministic: requestAnimationFrame is stubbed before the runtime builds and
// ResizeObserver is a no-op, so every Measure pass here comes from `notify`.
import * as Projection from "@wardic/core/Projection"
import { describe, expect, it } from "@effect/vitest"
import type * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Tracer from "effect/Tracer"
import { afterEach, beforeEach, vi } from "vitest"
import { DomLive } from "@wardic/dom"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"

type FrameCallback = (t: number) => void

let pendingFrames: Map<number, FrameCallback>
let nextHandle: number
let frameTime: number

beforeEach(() => {
  pendingFrames = new Map()
  nextHandle = 1
  frameTime = 1000
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCallback) => {
    const handle = nextHandle++
    pendingFrames.set(handle, cb)
    return handle
  })
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pendingFrames.delete(handle)
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.querySelectorAll("[data-fold-stage]").forEach((el) => el.remove())
  window.scrollTo(0, 0)
})

const fireFrame = (): void => {
  frameTime += 1000 / 60
  const callbacks = [...pendingFrames.values()]
  pendingFrames.clear()
  for (const cb of callbacks) cb(frameTime)
}

const endOfTask = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

type Write = { readonly id: string; readonly tx: number; readonly ty: number }

const makeSink = () => {
  const writes: Array<Write> = []
  const sink = {
    write: (id: string, partial: Record<string, unknown>): void => {
      const value = partial[Projection.KEY] as { delta: { x: { translate: number }; y: { translate: number } } } | undefined
      if (value === undefined) return
      writes.push({ id, tx: value.delta.x.translate, ty: value.delta.y.translate })
    },
    flushPass: (pass: () => void): void => pass(),
  }
  return { sink, writes }
}

const makeEngine = (sink: ReturnType<typeof makeSink>["sink"]) => {
  const spans: Array<Record<string, unknown>> = []
  class MeasureSpan extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      super.end(endTime, exit)
      spans.push(Object.fromEntries(this.attributes))
    }
  }
  const tracer = Tracer.make({
    span: (options) =>
      options.name === "wardic.projection.measure" ? new MeasureSpan(options) : new Tracer.NativeSpan(options),
  })
  const runtime = ManagedRuntime.make(Layer.merge(DomLive, Layer.succeed(Tracer.Tracer, tracer)))
  const system = ProjectionSystem.make(runtime, sink)
  return {
    system,
    spans,
    dispose: (): void => {
      system.dispose()
      void runtime.dispose()
    },
  }
}

const stage = (): HTMLElement => {
  const el = document.createElement("div")
  el.dataset.foldStage = ""
  el.style.cssText = "position:relative;width:800px;height:600px"
  document.body.append(el)
  return el
}

/** A plain scroll container (not a node): `css` sets its size and overflow. */
const scroller = (parent: HTMLElement, css: string): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText = css
  parent.append(el)
  return el
}

/** A block of flow children, 50 px tall with 10 px between them, in `parent`. */
const column = (parent: HTMLElement, n: number, css = ""): Array<HTMLElement> => {
  const content = document.createElement("div")
  content.style.cssText = `position:relative;${css}`
  parent.append(content)
  return Array.from({ length: n }, () => {
    const el = document.createElement("div")
    el.style.cssText = "width:180px;height:50px;margin-bottom:10px"
    content.append(el)
    return el
  })
}

const registerAll = (
  system: ReturnType<typeof makeEngine>["system"],
  els: ReadonlyArray<HTMLElement>,
  prefix = "n",
): Array<ProjectionSystem.NodeHandle> => els.map((element, i) => system.register({ id: `${prefix}${i}`, element, transition: () => ({ type: "spring" }) }))

/** Register, let the first Measure pass run, and settle into a frame. */
const mount = async (system: ReturnType<typeof makeEngine>["system"], els: ReadonlyArray<HTMLElement>) => {
  const handles = registerAll(system, els)
  await endOfTask()
  fireFrame()
  return handles
}

/** Run one Measure pass with nothing changed, and return its span's attributes. */
const unrelatedPass = async (e: ReturnType<typeof makeEngine>, handle: ProjectionSystem.NodeHandle) => {
  const before = e.spans.length
  handle.notify()
  await endOfTask()
  return e.spans[before]
}

describe("every scrollable ancestor is folded (ADR-0012, Amendment (Reorder))", () => {
  it("AF1: a plain overflow:auto container scrolled 60 px between passes seeds nothing at the next pass", async () => {
    const e = makeEngine(makeSink().sink)
    const box = scroller(stage(), "width:220px;height:200px;overflow:auto")
    const handles = await mount(e.system, column(box, 8))
    box.scrollTop = 60
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF2: nested plain containers (the outer scrolled 40, the inner 60) seed nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const outer = scroller(stage(), "width:260px;height:300px;overflow:auto")
    const spacer = document.createElement("div")
    spacer.style.cssText = "height:100px"
    outer.append(spacer)
    const inner = scroller(outer, "width:220px;height:200px;overflow:auto")
    const tail = document.createElement("div")
    tail.style.cssText = "height:300px"
    outer.append(tail)
    const handles = await mount(e.system, column(inner, 8))
    outer.scrollTop = 40
    inner.scrollTop = 60
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF3: an overflow:hidden container scrolled from code seeds nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const box = scroller(stage(), "width:220px;height:200px;overflow:hidden")
    const handles = await mount(e.system, column(box, 8))
    box.scrollTop = 60
    expect(box.scrollTop).toBe(60)
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF4: a horizontal container scrolled 90 px seeds nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const box = scroller(stage(), "width:230px;height:72px;overflow:auto")
    const row = document.createElement("div")
    row.style.cssText = "display:flex;gap:10px;width:max-content"
    box.append(row)
    const els = Array.from({ length: 8 }, () => {
      const el = document.createElement("div")
      el.style.cssText = "width:80px;height:50px;flex:none"
      row.append(el)
      return el
    })
    const handles = await mount(e.system, els)
    box.scrollLeft = 90
    expect(box.scrollLeft).toBe(90)
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF5 (guard): a layoutScroll container node still folds its scroll", async () => {
    const e = makeEngine(makeSink().sink)
    const box = scroller(stage(), "width:220px;height:200px;overflow:auto")
    e.system.register({ id: "scroller", element: box, transition: () => ({ type: "spring" }), layoutScroll: true })
    const handles = await mount(e.system, column(box, 8))
    box.scrollTop = 60
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF6 (guard): a position:fixed layoutScroll root's subtree doesn't fold the page's scroll", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    const tall = document.createElement("div")
    tall.style.cssText = "height:3000px"
    root.append(tall)
    const fixedRoot = scroller(root, "position:fixed;left:400px;top:0;width:200px;height:200px;overflow:auto")
    e.system.register({ id: "fixed-root", element: fixedRoot, transition: () => ({ type: "spring" }), layoutScroll: true })
    const handles = await mount(e.system, column(fixedRoot, 2))
    window.scrollTo(0, 100)
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF7: whether an ancestor is scrollable is read once per element, not per pass", async () => {
    const e = makeEngine(makeSink().sink)
    const box = scroller(stage(), "width:220px;height:200px;overflow:auto")
    const els = column(box, 3)
    const content = els[0]!.parentElement!
    const handles = await mount(e.system, els)
    const real = window.getComputedStyle.bind(window)
    const counts = new Map<Element, number>()
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
      counts.set(el, (counts.get(el) ?? 0) + 1)
      return real(el, pseudo)
    })
    try {
      for (let k = 0; k < 3; k++) await unrelatedPass(e, handles[0]!)
      // The very first pass (at mount) may have read them already; three more add nothing.
      expect(counts.get(content) ?? 0).toBe(0)
      expect(counts.get(box) ?? 0).toBe(0)
    } finally {
      spy.mockRestore()
    }
    // And the first pass after a fresh mount reads each ancestor exactly once.
    const e2 = makeEngine(makeSink().sink)
    const box2 = scroller(stage(), "width:220px;height:200px;overflow:auto")
    const els2 = column(box2, 3)
    const content2 = els2[0]!.parentElement!
    const counts2 = new Map<Element, number>()
    const spy2 = vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
      counts2.set(el, (counts2.get(el) ?? 0) + 1)
      return real(el, pseudo)
    })
    try {
      const handles2 = await mount(e2.system, els2)
      await unrelatedPass(e2, handles2[0]!)
      expect(counts2.get(content2)).toBe(1)
      expect(counts2.get(box2)).toBe(1)
    } finally {
      spy2.mockRestore()
    }
    e.dispose()
    e2.dispose()
  })

  it("AF8: a layoutId switch between two differently scrolled plain containers starts at the leaver's box", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const a = scroller(root, "position:absolute;left:0;top:0;width:220px;height:200px;overflow:auto")
    const b = scroller(root, "position:absolute;left:300px;top:0;width:220px;height:200px;overflow:auto")
    const [aEls, bEls] = [column(a, 8), column(b, 8)]
    const leaverEl = aEls[4]!
    const leaver = e.system.register({ id: "leaver", element: leaverEl, transition: () => ({ type: "spring" }), layoutId: "t" })
    await endOfTask()
    fireFrame()
    // A scrolls after the last pass, then the leaver leaves the DOM before its dispose.
    a.scrollTop = 50
    b.scrollTop = 100
    const from = leaverEl.getBoundingClientRect()
    leaverEl.remove()
    leaver.dispose()
    const enterEl = bEls[2]!
    e.system.register({ id: "enter", element: enterEl, transition: () => ({ type: "spring" }), layoutId: "t" })
    await endOfTask()
    const to = enterEl.getBoundingClientRect()
    const first = sk.writes.find((w) => w.id === "enter")!
    expect(first.tx).toBeCloseTo(from.left - to.left, 0)
    expect(first.ty).toBeCloseTo(from.top - to.top, 0)
    e.dispose()
  })

  it("AF9: a container scrolled before a drag keeps the dragged item under the pointer through a mid-drag pass, and seeds only what moved", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const box = scroller(stage(), "width:220px;height:200px;overflow:auto")
    const [zEl, aEl, bEl, cEl] = column(box, 6)
    const [z, a, b] = await mount(e.system, [zEl!, aEl!, bEl!, cEl!])
    void z
    box.scrollTop = 60
    // Grab b where it now paints, and move it 20 px down.
    const grab = bEl!.getBoundingClientRect()
    b!.dragStart()
    b!.dragMove({ x: 0, y: 20 })
    await endOfTask()
    fireFrame()
    // a grows 20 px: b and c move down; z (above a) doesn't.
    const before = e.spans.length
    aEl!.style.height = "70px"
    a!.notify()
    await endOfTask()
    const pass = e.spans[before]
    const bWrite = sk.writes.filter((w) => w.id === "n2").at(-1)!
    const painted = bEl!.getBoundingClientRect().top + bWrite.ty
    expect(Math.abs(painted - (grab.top + 20)), "b stays where the pointer holds it").toBeLessThan(2)
    expect(pass?.seeded, "a (resized) and c (moved) only; z didn't move").toBe(2)
    e.dispose()
  })

  it("AF10: a plain position:fixed element stops the fold too: its subtree folds neither a container's scroll above it nor the page's", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    const tall = document.createElement("div")
    tall.style.cssText = "height:3000px"
    root.append(tall)
    const box = scroller(root, "position:absolute;left:0;top:0;width:220px;height:200px;overflow:auto")
    const content = document.createElement("div")
    content.style.cssText = "height:480px"
    box.append(content)
    const fixedPlain = document.createElement("div")
    fixedPlain.style.cssText = "position:fixed;left:650px;top:0;width:200px;height:200px"
    content.append(fixedPlain)
    const handles = await mount(e.system, column(fixedPlain, 2))
    // Neither scroll moves the fixed element's children on screen.
    box.scrollTop = 60
    window.scrollTo(0, 100)
    expect((await unrelatedPass(e, handles[0]!))?.seeded).toBe(0)
    e.dispose()
  })

  it("AF11: a node that is itself plain position:fixed folds nothing: a page scroll between passes seeds nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    const tall = document.createElement("div")
    tall.style.cssText = "height:3000px"
    root.append(tall)
    const fixed = document.createElement("div")
    fixed.style.cssText = "position:fixed;left:650px;top:20px;width:100px;height:50px"
    root.append(fixed)
    const [handle] = await mount(e.system, [fixed])
    window.scrollTo(0, 100)
    expect((await unrelatedPass(e, handle!))?.seeded).toBe(0)
    e.dispose()
  })
})
