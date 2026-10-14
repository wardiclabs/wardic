// A layoutRoot isolates its subtree from an ancestor's layout animation, and every ancestor's
// delta counts in its descendants' corrections (ADR-0013, *Amendment (#33)*), checked against
// a fake ProjectionSink with every Refresh frame fired by hand.
//
// Nothing here is painted: a node paints at its box plus the translates of its ancestors'
// last writes and its own (every node here moves by translation only), so painted positions
// are summed down the tree.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type { ProjectionNodeHandle, RegisterNodeOptions } from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

/** `id`'s translate as last written ({0,0} before any). */
const t = (sk: Sink, id: string): { readonly x: number; readonly y: number } => {
  const w = sk.of(id).at(-1)
  return { x: w?.tx ?? 0, y: w?.ty ?? 0 }
}

/** An absolutely positioned box in `parent`. */
const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

/** Where `chain`'s last node paints: its layout position (the stage's frame) plus every translate down the chain. */
const painted = (sk: Sink, chain: ReadonlyArray<readonly [string, HTMLElement]>): { x: number; y: number } => {
  const last = chain[chain.length - 1]![1]
  const at = last.getBoundingClientRect()
  const stageAt = (last.closest("[data-harness-stage]") as HTMLElement).getBoundingClientRect()
  return chain.reduce(
    (p, [id]) => ({ x: p.x + t(sk, id).x, y: p.y + t(sk, id).y }),
    { x: at.left - stageAt.left, y: at.top - stageAt.top },
  )
}

/** `n` frames, each followed by `read`, collected. */
const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

describe("a layoutRoot isolates its subtree from an ancestor's layout animation (ADR-0013, Amendment (#33))", () => {
  it("LR1: under a FLIPping parent, the layoutRoot and a node FLIPping inside it take their new place from the first frame (#33's scene)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const cEl = makeBox(rEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, { layoutRoot: true })
    const c = register(e, "c", cEl)
    await endOfTask()
    fireFrame()
    // P moves 100 px down; C moves 140 px right inside R; one pass.
    pEl.style.top = "140px"
    cEl.style.left = "150px"
    p.notify()
    c.notify()
    await endOfTask()
    const run = [
      { p: painted(sk, [["p", pEl]]), r: painted(sk, [["p", pEl], ["r", rEl]]), c: painted(sk, [["p", pEl], ["r", rEl], ["c", cEl]]) },
      ...frames(60, () => ({ p: painted(sk, [["p", pEl]]), r: painted(sk, [["p", pEl], ["r", rEl]]), c: painted(sk, [["p", pEl], ["r", rEl], ["c", cEl]]) })),
    ]
    expect(run[1]!.p.y, "P flies").toBeLessThan(100)
    run.forEach((f, k) => {
      expect(f.r.y, `frame ${k}: R at its new place`).toBeCloseTo(170, 6)
      expect(f.c.y, `frame ${k}: C's row at its new place`).toBeCloseTo(180, 6)
    })
    // C's own move animates, inside R.
    expect(run[1]!.c.x).toBeGreaterThan(60)
    expect(run[1]!.c.x).toBeLessThan(190)
    expect(run.at(-1)!.c.x).toBeCloseTo(200, 6)
    e.dispose()
  })

  it("LR2: without a layoutRoot, the node rides its FLIPping parent (guard)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const cEl = makeBox(pEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    const c = register(e, "c", cEl)
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    cEl.style.left = "150px"
    p.notify()
    c.notify()
    await endOfTask()
    const rows = frames(60, () => painted(sk, [["p", pEl], ["c", cEl]]).y - painted(sk, [["p", pEl]]).y)
    rows.forEach((y, k) => expect(y, `frame ${k}`).toBeCloseTo(10, 6))
    e.dispose()
  })

  it("LR3: a slot move during a release: the layoutRoot and its node take their new place on that axis, the Release offset still carries them", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 160, 90)
    const rEl = makeBox(dEl, 60, 10, 90, 70)
    const gEl = makeBox(rEl, 10, 10, 20, 20)
    const d = register(e, "d", dEl)
    register(e, "r", rEl, { layoutRoot: true })
    register(e, "g", gEl)
    await endOfTask()
    fireFrame()
    // Dragged 100 px right only, and released: the Release offset runs on x.
    d.dragStart()
    d.dragMove({ x: 100, y: 0 })
    fireFrame()
    d.dragEnd()
    await endOfTask()
    frames(3, () => undefined)
    // The slot moves 60 px down: D FLIPs on y under its release.
    dEl.style.top = "60px"
    d.notify()
    await endOfTask()
    const at = () => ({
      d: painted(sk, [["d", dEl]]),
      r: painted(sk, [["d", dEl], ["r", rEl]]),
      g: painted(sk, [["d", dEl], ["r", rEl], ["g", gEl]]),
    })
    const run = [at(), ...frames(60, at)]
    expect(run[1]!.d.y, "D flies down to its new slot").toBeLessThan(55)
    run.forEach((f, k) => {
      expect(f.r.y, `frame ${k}: R's row at its new place`).toBeCloseTo(70, 6)
      expect(f.g.y, `frame ${k}: G's row at its new place`).toBeCloseTo(80, 6)
      // On x the Release offset carries R and G with D, G on R.
      expect(f.r.x - f.d.x, `frame ${k}: R on D on x`).toBeCloseTo(60, 6)
      expect(f.g.x - f.r.x, `frame ${k}: G on R`).toBeCloseTo(10, 6)
    })
    e.dispose()
  })

  it("LR4: a node running inside a layoutRoot inside a dragged node keeps its line through the release", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 160, 90)
    const rEl = makeBox(dEl, 60, 10, 90, 70)
    const gEl = makeBox(rEl, 10, 10, 20, 20)
    const d = register(e, "d", dEl)
    register(e, "r", rEl, { layoutRoot: true })
    const g = register(e, "g", gEl, { transition: () => ({ type: "spring", stiffness: 30, damping: 12 }) })
    await endOfTask()
    fireFrame()
    // G starts a slow FLIP across R on x; D is then dragged on y and released.
    gEl.style.left = "60px"
    g.notify()
    await endOfTask()
    fireFrame()
    d.dragStart()
    d.dragMove({ x: 0, y: 40 })
    frames(3, () => undefined)
    d.dragEnd()
    await endOfTask()
    // G against D on y: it never moves on y, inside R or with D.
    const rows = frames(120, () => painted(sk, [["d", dEl], ["r", rEl], ["g", gEl]]).y - painted(sk, [["d", dEl]]).y)
    rows.forEach((y, k) => expect(y, `frame ${k}`).toBeCloseTo(20, 6))
    e.dispose()
  })

  it("LR5: a Measure pass from elsewhere during the parent's FLIP leaves the layoutRoot at its new place", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const qEl = makeBox(root, 400, 40, 40, 40)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, { layoutRoot: true })
    const q = register(e, "q", qEl)
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    p.notify()
    await endOfTask()
    frames(5, () => undefined)
    // Q moves; R's box doesn't; P still flies.
    qEl.style.top = "80px"
    q.notify()
    await endOfTask()
    expect(painted(sk, [["p", pEl]]).y, "P still flies").toBeLessThan(130)
    expect(painted(sk, [["p", pEl], ["r", rEl]]).y, "on the pass's frame").toBeCloseTo(170, 6)
    frames(30, () => painted(sk, [["p", pEl], ["r", rEl]]).y).forEach((y, k) => expect(y, `frame ${k}`).toBeCloseTo(170, 6))
    e.dispose()
  })

  it("LR6: a layoutRoot inside a dragged node inside a released one rides the dragged one (its drag target is where it paints)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const oEl = makeBox(root, 0, 0, 300, 200)
    const iEl = makeBox(oEl, 20, 20, 200, 120)
    const rEl = makeBox(iEl, 60, 10, 90, 70)
    const o = register(e, "o", oEl)
    const i = register(e, "i", iEl)
    register(e, "r", rEl, { layoutRoot: true })
    await endOfTask()
    fireFrame()
    // O dragged 100 px right and released; while it flies back, I is dragged 40 px down.
    o.dragStart()
    o.dragMove({ x: 100, y: 0 })
    fireFrame()
    o.dragEnd()
    await endOfTask()
    frames(3, () => undefined)
    i.dragStart()
    i.dragMove({ x: 0, y: 40 })
    const offsets = frames(30, () => {
      const at = painted(sk, [["o", oEl], ["i", iEl]])
      const r = painted(sk, [["o", oEl], ["i", iEl], ["r", rEl]])
      return { x: r.x - at.x, y: r.y - at.y, o: painted(sk, [["o", oEl]]).x }
    })
    expect(offsets[0]!.o, "O still flies back").toBeGreaterThan(10)
    offsets.forEach((f, k) => {
      expect(f.x, `frame ${k}: R on I`).toBeCloseTo(60, 6)
      expect(f.y, `frame ${k}: R on I`).toBeCloseTo(10, 6)
    })
    i.dragEnd()
    e.dispose()
  })

  it("LR7: a layoutRoot inside a released node inside a released one rides both", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const oEl = makeBox(root, 0, 0, 300, 200)
    const iEl = makeBox(oEl, 20, 20, 200, 120)
    const rEl = makeBox(iEl, 60, 10, 90, 70)
    const o = register(e, "o", oEl)
    const i = register(e, "i", iEl)
    register(e, "r", rEl, { layoutRoot: true })
    await endOfTask()
    fireFrame()
    // O dragged 100 px right and released; while it flies back, I is dragged 40 px down and released.
    o.dragStart()
    o.dragMove({ x: 100, y: 0 })
    fireFrame()
    o.dragEnd()
    await endOfTask()
    frames(3, () => undefined)
    i.dragStart()
    i.dragMove({ x: 0, y: 40 })
    fireFrame()
    i.dragEnd()
    await endOfTask()
    const offsets = frames(60, () => {
      const at = painted(sk, [["o", oEl], ["i", iEl]])
      const r = painted(sk, [["o", oEl], ["i", iEl], ["r", rEl]])
      return { x: r.x - at.x, y: r.y - at.y, o: painted(sk, [["o", oEl]]).x }
    })
    expect(offsets[0]!.o, "O still flies back").toBeGreaterThan(10)
    offsets.forEach((f, k) => {
      expect(f.x, `frame ${k}: R on I`).toBeCloseTo(60, 6)
      expect(f.y, `frame ${k}: R on I`).toBeCloseTo(10, 6)
    })
    e.dispose()
  })

  it("LR8: a node FLIPping in a layoutRoot that moved, interrupted again, goes on from where it paints", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const cEl = makeBox(rEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, { layoutRoot: true })
    const c = register(e, "c", cEl, { transition: () => ({ type: "spring", stiffness: 30, damping: 12 }) })
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    cEl.style.left = "150px"
    p.notify()
    c.notify()
    await endOfTask()
    const at = () => painted(sk, [["p", pEl], ["r", rEl], ["c", cEl]])
    const before = frames(10, at).at(-1)!
    // C's own box changes again mid-flight; R doesn't move this time.
    cEl.style.left = "100px"
    c.notify()
    await endOfTask()
    const run = [before, at(), ...frames(200, at)]
    expect(run[1]!.x, "no jump at the interrupt").toBeCloseTo(before.x, 6)
    run.forEach((f, k) => expect(f.y, `frame ${k}: C's row at its new place`).toBeCloseTo(180, 6))
    expect(run.at(-1)!.x).toBeCloseTo(150, 0)
    e.dispose()
  })

  it("LR9: nodes FLIPping inside each other in a layoutRoot that moved start where they paint", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const xEl = makeBox(rEl, 10, 10, 120, 80)
    const gEl = makeBox(xEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, { layoutRoot: true })
    const x = register(e, "x", xEl)
    const g = register(e, "g", gEl)
    await endOfTask()
    fireFrame()
    // P moves 100 px down, X 60 px right in R, G 40 px right in X: one pass.
    pEl.style.top = "140px"
    xEl.style.left = "70px"
    gEl.style.left = "50px"
    p.notify()
    x.notify()
    g.notify()
    await endOfTask()
    const at = () => ({ x: painted(sk, [["p", pEl], ["r", rEl], ["x", xEl]]), g: painted(sk, [["p", pEl], ["r", rEl], ["x", xEl], ["g", gEl]]) })
    const run = [at(), ...frames(60, at)]
    // On the pass's frame both paint where they were, moved with R.
    expect(run[0]!.x).toEqual({ x: 60, y: 180 })
    expect(run[0]!.g.x).toBeCloseTo(70, 6)
    run.forEach((f, k) => {
      expect(f.x.y, `frame ${k}: X's row`).toBeCloseTo(180, 6)
      expect(f.g.y, `frame ${k}: G's row`).toBeCloseTo(190, 6)
    })
    expect(run.at(-1)!.g.x).toBeCloseTo(170, 6)
    e.dispose()
  })

  it("LR10: a layoutRoot that grows carries a node anchored at its centre to its new place at once", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const rEl = makeBox(root, 40, 40, 200, 100)
    const cEl = el(rEl, "position:absolute;left:calc(50% - 10px);top:10px;width:20px;height:20px")
    const r = register(e, "r", rEl, { layoutRoot: true })
    register(e, "c", cEl, { layoutAnchor: { x: 0.5, y: 0.5 } })
    await endOfTask()
    fireFrame()
    const writes = sk.of("c").length
    // R grows 100 px wide: C, at its centre, moves 50 px right with it.
    rEl.style.width = "300px"
    r.notify()
    await endOfTask()
    frames(30, () => undefined)
    expect(sk.of("c").length, "C isn't animated").toBe(writes)
    e.dispose()
  })

  it("LR11: a resting node in a layoutRoot under a FLIPping parent isn't animated (nothing written)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const sEl = makeBox(rEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, { layoutRoot: true })
    register(e, "s", sEl)
    await endOfTask()
    fireFrame()
    const writes = sk.of("s").length
    pEl.style.top = "140px"
    p.notify()
    await endOfTask()
    frames(30, () => undefined)
    expect(sk.of("s").length).toBe(writes)
    e.dispose()
  })
})
