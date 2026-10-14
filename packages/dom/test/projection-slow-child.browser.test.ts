// A running node whose relative parent's layout animation lands first goes on from where it
// paints (#144), checked against a fake ProjectionSink with every Refresh frame fired by hand.
//
// Nothing here is painted: a node paints at its box plus the translates of its ancestors' last
// writes and its own (every node here moves by translation only), so painted positions are
// summed down the tree.
import { describe, expect, it } from "@effect/vitest"
import type * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
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
type Chain = ReadonlyArray<readonly [string, HTMLElement]>

/** #38's slow spring (the layout lab's M), and a slower one still. */
const SLOW = { stiffness: 30, damping: 12 }
const SLOWER = { stiffness: 12, damping: 7 }

/** `id`'s translate as last written ({0,0} before any). */
const t = (sk: Sink, id: string): { readonly x: number; readonly y: number } => {
  const w = sk.of(id).at(-1)
  return { x: w?.tx ?? 0, y: w?.ty ?? 0 }
}

/** An absolutely positioned box in `parent`. */
const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, spring: object = {}, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring", ...spring }), ...opts })

/** Where `chain`'s last node paints: its layout position (the stage's frame) plus every translate down the chain. */
const painted = (sk: Sink, chain: Chain): { x: number; y: number } => {
  const last = chain[chain.length - 1]![1]
  const at = last.getBoundingClientRect()
  const stageAt = (last.closest("[data-harness-stage]") as HTMLElement).getBoundingClientRect()
  return chain.reduce((p, [id]) => ({ x: p.x + t(sk, id).x, y: p.y + t(sk, id).y }), { x: at.left - stageAt.left, y: at.top - stageAt.top })
}

/** Where `inner` paints against `outer`, the end of its chain. */
const offsetOf = (sk: Sink, inner: Chain, outer: Chain): { x: number; y: number } => {
  const a = painted(sk, inner)
  const b = painted(sk, outer)
  return { x: a.x - b.x, y: a.y - b.y }
}

/** `n` frames, each followed by `read`, collected. */
const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

/** `el`'s layout box against the stage (the fake sink paints nothing, so this is its untransformed box). */
const layoutBoxOf = (element: HTMLElement): Box.Box => {
  const at = element.getBoundingClientRect()
  const stageAt = (element.closest("[data-harness-stage]") as HTMLElement).getBoundingClientRect()
  return { x: { min: at.left - stageAt.left, max: at.right - stageAt.left }, y: { min: at.top - stageAt.top, max: at.bottom - stageAt.top } }
}

const IDENTITY: Projection.Delta = {
  x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
}

/** `id`'s last written delta (the identity before any). */
const deltaOf = (sk: Sink, id: string): Projection.Delta => {
  const w = sk.of(id).at(-1)
  if (w === undefined) return IDENTITY
  return (w.value as unknown as { readonly delta: Projection.Delta }).delta
}

/** Where `chain`'s last node paints, its own and every ancestor's delta applied as CSS composes them. */
const paintedBox = (sk: Sink, chain: Chain): Box.Box =>
  Projection.applyTreeDeltas(layoutBoxOf(chain[chain.length - 1]![1]), chain.map(([id]) => deltaOf(sk, id))).box

const centreOf = (b: Box.Box): { x: number; y: number } => ({ x: (b.x.min + b.x.max) / 2, y: (b.y.min + b.y.max) / 2 })

/** The largest change between consecutive steps of `xs`: a snap shows as one. */
const biggestKink = (xs: ReadonlyArray<number>): number =>
  xs.slice(2).reduce((worst, x, k) => Math.max(worst, Math.abs(x - 2 * xs[k + 1]! + xs[k]!)), 0)

describe("a running node goes on from where it paints when its relative parent lands first (#144)", () => {
  it("SC1: a slow child that only moves with its FLIPping parent stays on it through the parent's landing", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const mEl = makeBox(pEl, 10, 40, 30, 30)
    const p = register(e, "p", pEl)
    register(e, "m", mEl, SLOW)
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    p.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const M: Chain = [["p", pEl], ["m", mEl]]
    const run = frames(240, () => ({ m: offsetOf(sk, M, P), p: painted(sk, P).y }))
    expect(run[1]!.p, "P flies").toBeLessThan(130)
    run.forEach((f, k) => {
      expect(f.m.x, `frame ${k}`).toBeCloseTo(10, 6)
      expect(f.m.y, `frame ${k}`).toBeCloseTo(40, 6)
    })
    e.dispose()
  })

  it("SC2: a slow child moving inside its FLIPping parent slides on smoothly through the parent's landing", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const mEl = makeBox(pEl, 10, 40, 30, 30)
    const p = register(e, "p", pEl)
    const m = register(e, "m", mEl, SLOW)
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    mEl.style.left = "110px"
    p.notify()
    m.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const M: Chain = [["p", pEl], ["m", mEl]]
    const run = frames(240, () => offsetOf(sk, M, P))
    run.forEach((f, k) => expect(f.y, `frame ${k}: its row`).toBeCloseTo(40, 6))
    expect(biggestKink(run.map((f) => f.x)), "no snap in x").toBeLessThan(1)
    expect(run.at(-1)!.x).toBeCloseTo(110, 3)
    e.dispose()
  })

  it("SC3: a parent landing under a running chain leaves both running nodes on their lines", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const xEl = makeBox(pEl, 10, 20, 120, 100)
    const nEl = makeBox(xEl, 10, 20, 20, 20)
    const p = register(e, "p", pEl)
    const x = register(e, "x", xEl, SLOW)
    register(e, "n", nEl, SLOWER)
    await endOfTask()
    fireFrame()
    // P moves 100 px down, X 60 px right inside it; N only moves with X.
    pEl.style.top = "140px"
    xEl.style.left = "70px"
    p.notify()
    x.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const X: Chain = [["p", pEl], ["x", xEl]]
    const N: Chain = [["p", pEl], ["x", xEl], ["n", nEl]]
    const run = frames(400, () => ({ n: offsetOf(sk, N, X), x: offsetOf(sk, X, P) }))
    run.forEach((f, k) => {
      expect(f.n.x, `frame ${k}: N on X`).toBeCloseTo(10, 6)
      expect(f.n.y, `frame ${k}: N on X`).toBeCloseTo(20, 6)
      expect(f.x.y, `frame ${k}: X's row`).toBeCloseTo(20, 6)
    })
    expect(biggestKink(run.map((f) => f.x.x)), "X slides on").toBeLessThan(1)
    e.dispose()
  })

  it("SC4: a child landing under its still-flying parent leaves a slower grandchild on it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const lEl = makeBox(pEl, 10, 20, 120, 100)
    const nEl = makeBox(lEl, 10, 20, 20, 20)
    const p = register(e, "p", pEl, SLOW)
    const l = register(e, "l", lEl)
    register(e, "n", nEl, SLOWER)
    await endOfTask()
    fireFrame()
    // P (slow) moves 100 px down, L (fast) 60 px right inside it; N only moves with L.
    pEl.style.top = "140px"
    lEl.style.left = "70px"
    p.notify()
    l.notify()
    await endOfTask()
    const L: Chain = [["p", pEl], ["l", lEl]]
    const N: Chain = [["p", pEl], ["l", lEl], ["n", nEl]]
    const run = frames(400, () => offsetOf(sk, N, L))
    run.forEach((f, k) => {
      expect(f.x, `frame ${k}: N on L`).toBeCloseTo(10, 6)
      expect(f.y, `frame ${k}: N on L`).toBeCloseTo(20, 6)
    })
    e.dispose()
  })

  it("SC5: a child landing with its parent on the same frame leaves a slower grandchild on it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const lEl = makeBox(pEl, 10, 20, 120, 100)
    const nEl = makeBox(lEl, 10, 20, 20, 20)
    const p = register(e, "p", pEl)
    const l = register(e, "l", lEl)
    register(e, "n", nEl, SLOW)
    await endOfTask()
    fireFrame()
    // P and L on the same spring, from the same pass: they land on the same frame.
    pEl.style.top = "140px"
    lEl.style.left = "70px"
    p.notify()
    l.notify()
    await endOfTask()
    const L: Chain = [["p", pEl], ["l", lEl]]
    const N: Chain = [["p", pEl], ["l", lEl], ["n", nEl]]
    const run = frames(240, () => offsetOf(sk, N, L))
    run.forEach((f, k) => {
      expect(f.x, `frame ${k}: N on L`).toBeCloseTo(10, 6)
      expect(f.y, `frame ${k}: N on L`).toBeCloseTo(20, 6)
    })
    e.dispose()
  })

  it("SC6: a centre-anchored slow child of a parent that grows as it moves stays on the parent's centre through the landing", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 200, 200)
    const mEl = el(pEl, "position:absolute;left:calc(50% - 15px);top:40px;width:30px;height:30px")
    const p = register(e, "p", pEl)
    register(e, "m", mEl, SLOW, { layoutAnchor: { x: 0.5, y: 0.5 } })
    await endOfTask()
    fireFrame()
    // P moves 100 px down and grows 100 px wide: M, at its centre, moves 50 px right with it.
    pEl.style.top = "140px"
    pEl.style.width = "300px"
    p.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const M: Chain = [["p", pEl], ["m", mEl]]
    const run = frames(240, () => {
      const pc = centreOf(paintedBox(sk, P))
      const mc = centreOf(paintedBox(sk, M))
      return { x: mc.x - pc.x, y: mc.y - pc.y }
    })
    run.forEach((f, k) => {
      expect(f.x, `frame ${k}: on P's centre`).toBeCloseTo(0, 4)
      expect(f.y, `frame ${k}`).toBeCloseTo(-45, 4)
    })
    e.dispose()
  })

  it("SC7: a node held in a drag while its parent FLIPs and lands stays under the pointer (a guard: it has no layout animation to move)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const dEl = makeBox(pEl, 10, 40, 60, 60)
    const p = register(e, "p", pEl)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    // D is grabbed at rest and held 10 px right; then P moves 100 px down under it and lands.
    d.dragStart()
    d.dragMove({ x: 10, y: 0 })
    fireFrame()
    pEl.style.top = "140px"
    p.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const D: Chain = [["p", pEl], ["d", dEl]]
    const run = frames(120, () => painted(sk, D))
    expect(painted(sk, P).y, "P has landed").toBeCloseTo(140, 6)
    run.forEach((f, k) => {
      expect(f.x, `frame ${k}: under the pointer`).toBeCloseTo(60, 6)
      expect(f.y, `frame ${k}: under the pointer`).toBeCloseTo(80, 6)
    })
    expect(e.logs.filter((l) => l.message.includes("failed")), "nothing failed").toEqual([])
    d.dragEnd()
    e.dispose()
  })
})
