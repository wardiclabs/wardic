// A dragged projection node and the Measure pass (issue #26, ADR-0016 *Amendment
// (#26)*), checked against a fake ProjectionSink with every Refresh frame fired by hand.
//
// A dragged node and its subtree are drag-blocked: a Measure pass updates their slots
// only, re-derives and flushes them with their group, seeds nothing there (no Priming
// step), and counts them in the `wardic.projection.measure` span's `dragBlocked`. A
// resting descendant isn't derived while its only active ancestor is being dragged
// (CSS carries it); a running one is. A pointer move re-derives the dragged group into
// the sink at once, so the gate's next flush paints it. The release takes a Priming
// step at the end of its task, starts from the drag target, ends on the latest slot,
// and always writes the node's projection before it settles.
//
// Deterministic: requestAnimationFrame is stubbed before the runtime builds (the Clock
// reads it when its Layer builds), so the test fires Refresh frames by hand;
// ResizeObserver is stubbed to a no-op, so every Measure pass here comes from `notify`.
import { PROJECTION_KEY } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import type * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Tracer from "effect/Tracer"
import { afterEach, beforeEach, vi } from "vitest"
import { DomLive, makeProjectionSystem, type ProjectionNodeHandle } from "../src/index.ts"

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
  document.body.querySelectorAll("[data-drag-stage]").forEach((el) => el.remove())
})

/** Fire every pending Refresh frame at the next timestamp (one nominal interval later). */
const fireFrame = (): void => {
  frameTime += 1000 / 60
  const callbacks = [...pendingFrames.values()]
  pendingFrames.clear()
  for (const cb of callbacks) cb(frameTime)
}

/** Every microtask queued so far (and the ones they queue) has run; no timer has. */
const endOfTask = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

type LogEntry =
  | { readonly kind: "write"; readonly id: string; readonly tx: number; readonly ty: number }
  | { readonly kind: "flushPass:start" }
  | { readonly kind: "flushPass:end" }
  | { readonly kind: "frame" }

/** The fake sink: records every projection write, and brackets each flushPass's writes. */
const makeSink = () => {
  const log: Array<LogEntry> = []
  const sink = {
    write: (id: string, partial: Record<string, unknown>): void => {
      const value = partial[PROJECTION_KEY] as { delta: { x: { translate: number }; y: { translate: number } } } | undefined
      if (value === undefined) return
      log.push({ kind: "write", id, tx: value.delta.x.translate, ty: value.delta.y.translate })
    },
    flushPass: (pass: () => void): void => {
      log.push({ kind: "flushPass:start" })
      pass()
      log.push({ kind: "flushPass:end" })
    },
  }
  return { sink, log }
}

/** The ended `wardic.projection.measure` spans' attributes, in order. */
const makeMeasureSpans = () => {
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
  return { layer: Layer.succeed(Tracer.Tracer, tracer), spans }
}

/** Build the engine over `sink` with a DomLive runtime (rAF already stubbed) that records measure spans. */
const makeEngine = (sink: ReturnType<typeof makeSink>["sink"]) => {
  const measures = makeMeasureSpans()
  const runtime = ManagedRuntime.make(Layer.merge(DomLive, measures.layer))
  const system = makeProjectionSystem(runtime, sink)
  const dispose = (): void => {
    system.dispose()
    void runtime.dispose()
  }
  return { system, measures, dispose }
}

const stage = (): HTMLElement => {
  let el = document.body.querySelector<HTMLElement>("[data-drag-stage]")
  if (el === null) {
    el = document.createElement("div")
    el.dataset.dragStage = ""
    el.style.cssText = "position:relative;width:800px;height:400px"
    document.body.append(el)
  }
  return el
}

/** An absolutely positioned box in `parent` (the stage by default). */
const makeBox = (left: number, top: number, width: number, height: number, parent: HTMLElement = stage()): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`
  parent.append(el)
  return el
}

const writesFor = (entries: ReadonlyArray<LogEntry>, id: string) =>
  entries.filter((e): e is Extract<LogEntry, { kind: "write" }> => e.kind === "write" && e.id === id)

/** The writes inside the last flushPass. */
const insideLastFlush = (log: ReadonlyArray<LogEntry>): ReadonlyArray<LogEntry> => {
  let start = -1
  let end = -1
  log.forEach((e, k) => {
    if (e.kind === "flushPass:start") start = k
    if (e.kind === "flushPass:end") end = k
  })
  return start < 0 || end < 0 ? [] : log.slice(start + 1, end)
}

/** The log entries after the last `flushPass:end`. */
const afterLastFlush = (log: ReadonlyArray<LogEntry>): ReadonlyArray<LogEntry> => {
  let i = -1
  log.forEach((e, k) => {
    if (e.kind === "flushPass:end") i = k
  })
  return log.slice(i + 1)
}

/**
 * The scene: a draggable node D (160x80 at 0,0) holding a child node C (20x20 at
 * 10,10), and an unrelated node S at (400,0). Registered, first-measured.
 */
const mountScene = async (system: ReturnType<typeof makeEngine>["system"]) => {
  const dEl = makeBox(0, 0, 160, 80)
  const cEl = makeBox(10, 10, 20, 20, dEl)
  const sEl = makeBox(400, 0, 50, 50)
  const d: ProjectionNodeHandle = system.register({ id: "d", element: dEl, springOptions: () => ({}) })
  const c: ProjectionNodeHandle = system.register({ id: "c", element: cEl, springOptions: () => ({}) })
  const s: ProjectionNodeHandle = system.register({ id: "s", element: sEl, springOptions: () => ({}) })
  await endOfTask()
  fireFrame()
  return { dEl, cEl, sEl, d, c, s }
}

describe("a dragged projection node and the Measure pass (#26)", () => {
  it("N1: a mid-drag pass flushes the dragged node, seeds nothing in its tree, reports dragBlocked, and primes nothing there", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { dEl, sEl, d, s } = await mountScene(e.system)
    d.dragStart()
    d.dragMove({ x: 100, y: 30 })
    await endOfTask()
    fireFrame()
    fireFrame()
    const passesBefore = e.measures.spans.length

    dEl.style.top = "60px" // D's slot (and C with it) moves down by 60
    sEl.style.left = "450px" // S moves too: the one node this pass should seed
    d.notify()
    s.notify()
    await endOfTask()

    const pass = e.measures.spans[passesBefore]
    expect(writesFor(insideLastFlush(sk.log), "d").length, "D re-derived and flushed in the pass").toBeGreaterThan(0)
    expect(pass?.seeded, "only S is seeded").toBe(1)
    expect(pass?.dragBlocked, "D and C took slot-only updates").toBe(2)
    const primed = afterLastFlush(sk.log)
    expect(writesFor(primed, "d"), "no Priming step for D").toHaveLength(0)
    expect(writesFor(primed, "c"), "no Priming step for C").toHaveLength(0)
    e.dispose()
  })

  it("N2: while a node is dragged, a resting descendant gets no writes per frame and a running one gets one", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const dEl = makeBox(0, 0, 200, 80)
    const restEl = makeBox(10, 10, 20, 20, dEl)
    const runEl = makeBox(40, 10, 20, 20, dEl)
    const d = e.system.register({ id: "d", element: dEl, springOptions: () => ({}) })
    e.system.register({ id: "rest", element: restEl, springOptions: () => ({}) })
    const run = e.system.register({ id: "run", element: runEl, springOptions: () => ({ stiffness: 20, damping: 10 }) })
    await endOfTask()
    fireFrame()
    runEl.style.left = "140px" // "run" starts a slow FLIP inside D
    run.notify()
    await endOfTask()
    fireFrame()

    d.dragStart()
    d.dragMove({ x: 50, y: 0 })
    await endOfTask()
    fireFrame()
    const from = sk.log.length
    for (let i = 0; i < 5; i++) fireFrame()
    const frames = sk.log.slice(from)

    expect(writesFor(frames, "d"), "D written every frame").toHaveLength(5)
    expect(writesFor(frames, "run"), "the running descendant written every frame").toHaveLength(5)
    expect(writesFor(frames, "rest"), "the resting descendant not written (CSS carries it)").toHaveLength(0)
    e.dispose()
  })

  it("N3: a pointer move writes the dragged node into the sink at once, before any Refresh frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { d } = await mountScene(e.system)
    d.dragStart()
    d.dragMove({ x: 10, y: 0 })
    await endOfTask()
    fireFrame()
    fireFrame()
    const from = sk.log.length
    d.dragMove({ x: 40, y: 0 })
    const now = writesFor(sk.log.slice(from), "d")
    expect(now.length, "a write for D before the next frame").toBeGreaterThan(0)
    expect(now.at(-1)?.tx, "at the new pointer offset").toBeCloseTo(40, 3)
    e.dispose()
  })

  it("N4: the release takes a Priming step: before the next frame, D is one step from the drag target toward its slot", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { d } = await mountScene(e.system)
    d.dragStart()
    d.dragMove({ x: 100, y: 0 })
    await endOfTask()
    fireFrame()
    fireFrame()
    const from = sk.log.length
    d.dragEnd()
    await endOfTask()
    const last = writesFor(sk.log.slice(from), "d").at(-1)
    expect(last, "a write for D before the next frame").toBeDefined()
    expect(last!.tx, "moved off the drag target").toBeLessThan(99.9)
    expect(last!.tx, "not yet at the slot").toBeGreaterThan(0.1)
    e.dispose()
  })

  it("N5: a release that lands on the slot leaves the node's projection at identity", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { d } = await mountScene(e.system)
    d.dragStart()
    d.dragMove({ x: 50, y: 0 })
    await endOfTask()
    fireFrame() // a frame writes D 50 px off its slot
    d.dragMove({ x: 0, y: 0 }) // back on the slot, with no frame in between
    d.dragEnd()
    await endOfTask()
    for (let i = 0; i < 3; i++) fireFrame()
    const last = writesFor(sk.log, "d").at(-1)
    expect(last?.tx, "D's last projection write is at its slot").toBeCloseTo(0, 3)
    expect(last?.ty).toBeCloseTo(0, 3)
    e.dispose()
  })

  it("N7: a pass with nothing dragged reports dragBlocked 0", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { sEl, s } = await mountScene(e.system)
    const before = e.measures.spans.length
    sEl.style.left = "450px"
    s.notify()
    await endOfTask()
    const pass = e.measures.spans[before]
    expect(pass?.seeded, "S seeded").toBe(1)
    expect(pass?.dragBlocked, "nothing drag-blocked").toBe(0)
    e.dispose()
  })

  it("N6: after several slot moves, the release starts from the drag target and ends on the latest slot", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { dEl, d } = await mountScene(e.system)
    d.dragStart()
    d.dragMove({ x: 100, y: 30 })
    await endOfTask()
    fireFrame()
    for (const top of [60, 120]) {
      dEl.style.top = `${top}px`
      d.notify()
      await endOfTask()
      fireFrame()
      fireFrame()
    }
    const from = sk.log.length
    d.dragEnd()
    await endOfTask()
    for (let i = 0; i < 120; i++) fireFrame()
    const release = writesFor(sk.log.slice(from), "d")
    // The drag target, against the latest slot (top 120): (+100, 30 - 120).
    expect(release[0]!.tx, "starts at the drag target (x)").toBeGreaterThan(90)
    expect(release[0]!.ty, "starts at the drag target (y)").toBeLessThan(-80)
    expect(release.at(-1)!.tx, "ends on the latest slot (x)").toBeCloseTo(0, 1)
    expect(release.at(-1)!.ty, "ends on the latest slot (y)").toBeCloseTo(0, 1)
    e.dispose()
  })
})
