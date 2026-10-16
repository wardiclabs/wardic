// A box carries no transform an ancestor gives it (ADR-0012, *Amendment (#136)*), checked
// against a fake ProjectionSink with every Refresh frame fired by hand.
//
// A Measure pass used to read each node's box with the transforms of every ancestor that
// isn't a node still applied, and compare it with the last pass's box. A parent moved by
// a transform between two passes (its `animate`, a free drag, a stylesheet, another
// library) left a stale box: the node FLIPed from where it was painted before its parent
// moved. Now the pass holds every such ancestor at its transform's identity for the read
// (one that isn't `none`, so containing blocks stay as they are), and puts back exactly
// what it replaced. A transform mid CSS transition is left as it is: the documented limit.
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
  document.body.querySelectorAll("[data-tf-stage]").forEach((el) => el.remove())
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

/** Real time, for CSS transitions and animations: the stubbed rAF doesn't drive them. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type Write = { readonly id: string; readonly tx: number; readonly ty: number; readonly sx: number }

const makeSink = () => {
  const writes: Array<Write> = []
  const sink = {
    write: (id: string, partial: Record<string, unknown>): void => {
      const value = partial[Projection.KEY] as Projection.Value | undefined
      if (value === undefined) return
      writes.push({ id, tx: value.delta.x.translate, ty: value.delta.y.translate, sx: value.delta.x.scale })
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
  el.dataset.tfStage = ""
  el.style.cssText = "position:relative;width:800px;height:600px"
  document.body.append(el)
  return el
}

const div = (parent: HTMLElement, css: string): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText = css
  parent.append(el)
  return el
}

/** A stylesheet for the test, removed with the stage. */
const sheet = (parent: HTMLElement, css: string): void => {
  const el = document.createElement("style")
  el.textContent = css
  parent.append(el)
}

/** Register, let the first Measure pass run, and settle into a frame. */
const mount = async (e: ReturnType<typeof makeEngine>, element: HTMLElement, id = "n", layoutId?: string): Promise<ProjectionSystem.NodeHandle> => {
  const handle = e.system.register({ id, element, transition: () => ({ type: "spring" }), ...(layoutId !== undefined ? { layoutId } : {}) })
  await endOfTask()
  fireFrame()
  return handle
}

/** Run one Measure pass and return its span's attributes. */
const pass = async (e: ReturnType<typeof makeEngine>, handle: ProjectionSystem.NodeHandle) => {
  const before = e.spans.length
  handle.notify()
  await endOfTask()
  return e.spans[before]
}

describe("a box carries no ancestor transform (ADR-0012, Amendment (#136))", () => {
  it("TF1: a parent moved 100 px by its inline transform between passes seeds nothing at the next pass", async () => {
    const e = makeEngine(makeSink().sink)
    const parent = div(stage(), "position:absolute;left:40px;top:40px;width:300px;height:200px")
    const handle = await mount(e, div(parent, "width:60px;height:60px"))
    parent.style.transform = "translateX(100px)"
    expect((await pass(e, handle))?.seeded).toBe(0)
    e.dispose()
  })

  it("TF2: a stylesheet transform, and translate, scale and rotate, changed between passes seed nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    sheet(root, ".tf2-moved{transform:translateY(30px);translate:20px 10px;scale:1.5;rotate:10deg}")
    const parent = div(root, "position:absolute;left:40px;top:40px;width:300px;height:200px")
    const handle = await mount(e, div(parent, "width:60px;height:60px"))
    parent.classList.add("tf2-moved")
    expect((await pass(e, handle))?.seeded).toBe(0)
    e.dispose()
  })

  it("TF3: a node that moves 50 px inside a parent moved 100 px since the last pass FLIPs from where it painted: a 50 px delta, not 150", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const parent = div(stage(), "position:absolute;left:40px;top:40px;width:300px;height:200px")
    const node = div(parent, "position:absolute;left:0;top:0;width:60px;height:60px")
    const handle = await mount(e, node)
    parent.style.transform = "translateX(100px)"
    node.style.left = "50px"
    const before = sk.writes.length
    expect((await pass(e, handle))?.seeded).toBe(1)
    expect(sk.writes[before]?.tx).toBeCloseTo(-50, 1)
    e.dispose()
  })

  it("TF4: under a parent scaled 0.5, a node that moves 100 px of its layout FLIPs by 100 of the parent's px, so it starts where it painted", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const parent = div(stage(), "position:absolute;left:40px;top:40px;width:400px;height:200px;transform:scale(0.5);transform-origin:0 0")
    const node = div(parent, "position:absolute;left:0;top:0;width:60px;height:60px")
    const handle = await mount(e, node)
    node.style.left = "100px"
    const before = sk.writes.length
    await pass(e, handle)
    expect(sk.writes[before]?.tx).toBeCloseTo(-100, 1)
    e.dispose()
  })

  it("TF5: an ancestor is held at an identity that isn't none, so it stays the containing block of an absolutely positioned node", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    // Not positioned: only its transform makes it the node's containing block.
    const parent = div(root, "margin-left:200px;width:300px;height:200px;transform:translateX(50px)")
    const handle = await mount(e, div(parent, "position:absolute;left:10px;top:10px;width:60px;height:60px"))
    const parentLeft = parent.getBoundingClientRect().left - 50 // as laid out, without its transform
    expect(handle.layoutBox()?.x.min).toBeCloseTo(parentLeft + 10, 1)
    e.dispose()
  })

  it("TF6: an ancestor that declares a transition on its transform starts none, and its inline style comes back exactly", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    sheet(root, ".tf6{transition:transform 1s linear,opacity 1s}")
    const parent = div(root, "position:absolute;left:40px;top:40px;width:300px;height:200px;transform:translateX(30px)")
    parent.className = "tf6"
    const child = div(parent, "width:60px;height:60px")
    const handle = await mount(e, child)
    await sleep(50)
    const runs: Array<string> = []
    parent.addEventListener("transitionrun", (event) => runs.push(event.propertyName))
    const inline = parent.style.cssText
    // The node moves, so the pass holds its parent to read it.
    child.style.marginLeft = "20px"
    await pass(e, handle)
    expect(parent.style.cssText).toBe(inline)
    await sleep(100)
    expect(runs).toEqual([])
    expect(parent.getAnimations()).toEqual([])
    e.dispose()
  })

  it("TF7: each held property's inline value and priority, and transition-property's, come back exactly", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    sheet(root, ".tf7{translate:5px 0;transition:transform 1s}")
    const parent = div(root, "position:absolute;left:40px;top:40px;width:300px;height:200px")
    parent.className = "tf7"
    parent.style.setProperty("transform", "translateX(30px)")
    parent.style.setProperty("scale", "2", "important")
    parent.style.setProperty("transition-property", "transform", "important")
    const handle = await mount(e, div(parent, "width:60px;height:60px"))
    const inline = parent.style.cssText
    await pass(e, handle)
    expect(parent.style.cssText).toBe(inline)
    expect(parent.style.getPropertyValue("translate")).toBe("")
    expect(parent.style.getPropertyPriority("scale")).toBe("important")
    e.dispose()
  })

  it("TF8 (limit): an ancestor whose transform is mid CSS transition is left as it is: the transition runs on, and its offset is in the box", async () => {
    const e = makeEngine(makeSink().sink)
    const parent = div(stage(), "position:absolute;left:40px;top:40px;width:300px;height:200px;transition:transform 2s linear")
    const handle = await mount(e, div(parent, "width:60px;height:60px"))
    const rest = handle.layoutBox()!.x.min
    parent.style.transform = "translateX(100px)"
    await sleep(300)
    const [transition] = parent.getAnimations()
    expect(transition).toBeInstanceOf(CSSTransition)
    await pass(e, handle)
    expect(parent.getAnimations()).toEqual([transition])
    expect(transition!.playState).toBe("running")
    const offset = handle.layoutBox()!.x.min - rest
    expect(offset).toBeGreaterThan(5)
    expect(offset).toBeLessThan(95)
    e.dispose()
  })

  it("TF9: a CSS animation on an ancestor's transform stays out of the box, and keeps running", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    sheet(root, "@keyframes tf9{from{transform:translateX(0)}to{transform:translateX(100px)}} .tf9{animation:tf9 2s linear infinite alternate}")
    const parent = div(root, "position:absolute;left:40px;top:40px;width:300px;height:200px")
    parent.className = "tf9"
    const handle = await mount(e, div(parent, "width:60px;height:60px"))
    await sleep(300)
    expect((await pass(e, handle))?.seeded).toBe(0)
    const [animation] = parent.getAnimations()
    expect(animation?.playState).toBe("running")
    e.dispose()
  })

  it("TF10 (guard): a node's parent that is itself a node isn't held: a stylesheet's transform on it stays in its box, and so in its children's", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    sheet(root, ".tf10{transform:translateX(10px)}")
    const outer = div(root, "position:absolute;left:40px;top:40px;width:300px;height:200px")
    outer.className = "tf10"
    const inner = div(outer, "width:60px;height:60px")
    const outerHandle = e.system.register({ id: "outer", element: outer, transition: () => ({ type: "spring" }) })
    e.system.register({ id: "inner", element: inner, transition: () => ({ type: "spring" }) })
    await endOfTask()
    fireFrame()
    const set = vi.spyOn(outer.style, "setProperty")
    // The inner node moves, so the pass walks its ancestors: the outer is a node, not held.
    inner.style.marginLeft = "20px"
    expect((await pass(e, outerHandle))?.seeded).toBe(1)
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
    e.dispose()
  })

  it("TF11: a layoutId Switch into a parent scaled 0.5 starts on the leaver's painted box", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaverEl = div(root, "position:absolute;left:40px;top:300px;width:100px;height:80px")
    const leaver = await mount(e, leaverEl, "leaver", "t")
    const from = leaverEl.getBoundingClientRect()
    leaverEl.remove()
    leaver.dispose()
    const modal = div(root, "position:absolute;left:300px;top:40px;width:400px;height:300px;transform:scale(0.5);transform-origin:0 0")
    const enterEl = div(modal, "position:absolute;left:20px;top:20px;width:200px;height:160px")
    e.system.register({ id: "enter", element: enterEl, transition: () => ({ type: "spring" }), layoutId: "t" })
    await endOfTask()
    const first = sk.writes.find((w) => w.id === "enter")!
    // Its first frame in the modal's px: its 200 px box scaled about its centre (the
    // modal's x 20..220, centre 120), then moved; the modal paints that at half size.
    const minInModal = 120 - 100 * first.sx + first.tx
    const modalLeft = modal.getBoundingClientRect().left
    expect(modalLeft + 0.5 * minInModal).toBeCloseTo(from.left, 0)
    expect(0.5 * 200 * first.sx).toBeCloseTo(from.width, 0)
    e.dispose()
  })

  /**
   * A twin inside a modal scaled 0.5 leaves with the modal: detached by the time its
   * node is disposed, so its seed comes from its stored box, which leaves the modal's
   * scale out, put back where it painted. The enterer, 150x120 on the page, starts on that
   * painted box. Read the first write's left edge and width in the page's px.
   */
  const switchOut = async (e: ReturnType<typeof makeEngine>, sk: ReturnType<typeof makeSink>, root: HTMLElement, modal: HTMLElement, leaver: ProjectionSystem.NodeHandle) => {
    modal.remove()
    leaver.dispose()
    const enterEl = div(root, "position:absolute;left:40px;top:400px;width:150px;height:120px")
    const box = enterEl.getBoundingClientRect()
    e.system.register({ id: "enter", element: enterEl, transition: () => ({ type: "spring" }), layoutId: "t" })
    await endOfTask()
    const first = sk.writes.find((w) => w.id === "enter")!
    return { left: box.left + 75 - 75 * first.sx + first.tx, width: 150 * first.sx }
  }

  it("TF12 (guard): a Switch out of a scaled parent that leaves with its twin starts on the twin's painted box, through a pass that didn't move it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const modal = div(root, "position:absolute;left:300px;top:40px;width:400px;height:300px;transform:scale(0.5);transform-origin:0 0")
    const leaver = await mount(e, div(modal, "position:absolute;left:20px;top:20px;width:200px;height:160px"), "leaver", "t")
    // A pass that moves nothing: the twin keeps what its first pass found.
    const other = await mount(e, div(root, "position:absolute;left:0;top:560px;width:10px;height:10px"), "other")
    await pass(e, other)
    fireFrame()
    const from = modal.firstElementChild!.getBoundingClientRect()
    const first = await switchOut(e, sk, root, modal, leaver)
    expect(first.left).toBeCloseTo(from.left, 0)
    expect(first.width).toBeCloseTo(from.width, 0)
    e.dispose()
  })

  it("TF13 (guard): a twin whose parent's scale came off since its first pass starts the Switch from its unscaled box", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const modal = div(root, "position:absolute;left:300px;top:40px;width:400px;height:300px;transform:scale(0.5);transform-origin:0 0")
    const leaver = await mount(e, div(modal, "position:absolute;left:20px;top:20px;width:200px;height:160px"), "leaver", "t")
    modal.style.transform = "none"
    await pass(e, leaver)
    fireFrame()
    const from = modal.firstElementChild!.getBoundingClientRect()
    const first = await switchOut(e, sk, root, modal, leaver)
    expect(first.left).toBeCloseTo(from.left, 0)
    expect(first.width).toBeCloseTo(from.width, 0)
    e.dispose()
  })
})
