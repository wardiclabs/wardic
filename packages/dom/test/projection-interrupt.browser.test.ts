// A node whose layout animation a Measure pass interrupts restarts from where it paints, in the
// frame its placement starts from (#146, ADR-0013's *Amendment (#146)*), checked against a fake
// ProjectionSink with every Refresh frame fired by hand.
//
// Nothing here is painted: a node paints at its box plus the translates of its ancestors' last
// writes and its own (every node here moves by translation only), so painted positions are
// summed down the tree.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>
type Chain = ReadonlyArray<readonly [string, HTMLElement]>

/** #38's slow spring (the layout lab's M), and a fast, overdamped one. */
const SLOW = { stiffness: 30, damping: 12 }
const FAST = { stiffness: 600, damping: 50 }

/** `id`'s translate as last written ({0,0} before any). */
const t = (sk: Sink, id: string): { readonly x: number; readonly y: number } => {
  const w = sk.of(id).at(-1)
  return { x: w?.tx ?? 0, y: w?.ty ?? 0 }
}

/** An absolutely positioned box in `parent`. */
const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, spring: object = {}, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "spring", ...spring }), ...opts })

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

/**
 * P (300x200) with a child C at (10, 40) inside it, on their springs: P moves 100 px down, and
 * after `interruptAt` frames back up, a second pass that interrupts its flight. C's offset from P
 * every frame from the first pass on, the interrupt's frame included.
 */
const interrupted = async (pSpring: object, cSpring: object, interruptAt: number, cOpts: Partial<ProjectionSystem.RegisterNodeOptions> = {}) => {
  const sk = makeSink()
  const e = makeEngine(sk.sink)
  const root = stage()
  const pEl = makeBox(root, 40, 40, 300, 200)
  const cEl = makeBox(pEl, 10, 40, 30, 30)
  const p = register(e, "p", pEl, pSpring)
  register(e, "c", cEl, cSpring, cOpts)
  await endOfTask()
  fireFrame()
  pEl.style.top = "140px"
  p.notify()
  await endOfTask()
  const P: Chain = [["p", pEl]]
  const C: Chain = [["p", pEl], ["c", cEl]]
  const read = () => offsetOf(sk, C, P)
  const first = frames(interruptAt, read)
  pEl.style.top = "40px"
  p.notify()
  await endOfTask()
  const run = [...first, read(), ...frames(240, read)]
  const pAt = painted(sk, P).y
  e.dispose()
  return { run, pAt }
}

describe("a node whose layout animation is interrupted restarts from where it paints (#146)", () => {
  it("IR1: a slow child running on its FLIPping parent stays on it when the parent is sent back mid-flight (#146's scene)", async () => {
    const { run, pAt } = await interrupted({}, SLOW, 12)
    expect(pAt, "P is back").toBeCloseTo(40, 6)
    run.forEach((f, k) => {
      expect(f.x, `frame ${k}`).toBeCloseTo(10, 6)
      expect(f.y, `frame ${k}`).toBeCloseTo(40, 6)
    })
  })

  it("IR2: a fast child already at rest under its slow, still-flying parent stays on it when the parent is sent back", async () => {
    const { run } = await interrupted(SLOW, FAST, 40)
    run.forEach((f, k) => {
      expect(f.x, `frame ${k}`).toBeCloseTo(10, 6)
      expect(f.y, `frame ${k}`).toBeCloseTo(40, 6)
    })
  })

  it("IR3: a child on its parent's own spring stays on it through the interrupt (a guard: one progress)", async () => {
    const { run } = await interrupted({}, {}, 12)
    run.forEach((f, k) => expect(f.y, `frame ${k}`).toBeCloseTo(40, 6))
  })

  it("IR4: a slow child moving inside its parent slides on, with no jump, when the parent is sent back mid-flight", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const cEl = makeBox(pEl, 10, 40, 30, 30)
    const p = register(e, "p", pEl)
    const c = register(e, "c", cEl, SLOW)
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    cEl.style.left = "110px"
    p.notify()
    c.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const C: Chain = [["p", pEl], ["c", cEl]]
    const read = () => offsetOf(sk, C, P)
    const first = frames(12, read)
    pEl.style.top = "40px"
    p.notify()
    await endOfTask()
    const run = [...first, read(), ...frames(240, read)]
    run.forEach((f, k) => expect(f.y, `frame ${k}: its row`).toBeCloseTo(40, 6))
    // The restart starts C's own slide again from rest (a stall, as a restart is), not from elsewhere.
    expect(Math.abs(run[12]!.x - run[11]!.x), "no jump at the interrupt").toBeLessThan(Math.abs(run[11]!.x - run[10]!.x))
    expect(run.at(-1)!.x).toBeCloseTo(110, 3)
    e.dispose()
  })

  it("IR5: nodes running inside each other on slower springs stay on their lines when the outer parent is sent back mid-flight", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const xEl = makeBox(pEl, 10, 20, 120, 100)
    const nEl = makeBox(xEl, 10, 20, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "x", xEl, SLOW)
    register(e, "n", nEl, { stiffness: 12, damping: 7 })
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    p.notify()
    await endOfTask()
    const P: Chain = [["p", pEl]]
    const X: Chain = [["p", pEl], ["x", xEl]]
    const N: Chain = [["p", pEl], ["x", xEl], ["n", nEl]]
    const read = () => ({ x: offsetOf(sk, X, P), n: offsetOf(sk, N, X) })
    const first = frames(12, read)
    pEl.style.top = "40px"
    p.notify()
    await endOfTask()
    const run = [...first, read(), ...frames(300, read)]
    run.forEach((f, k) => {
      expect(f.x.y, `frame ${k}: X on P`).toBeCloseTo(20, 6)
      expect(f.n.y, `frame ${k}: N on X`).toBeCloseTo(20, 6)
      expect(f.n.x, `frame ${k}: N on X`).toBeCloseTo(10, 6)
    })
    e.dispose()
  })

  it("IR6: a slow node running inside a layoutRoot stays on its row in the root when the root's FLIPping parent is sent back", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const cEl = makeBox(rEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, {}, { layoutRoot: true })
    const c = register(e, "c", cEl, SLOW)
    await endOfTask()
    fireFrame()
    // P moves 100 px down, C 140 px right inside R (#33's scene); 12 frames in, P is sent back.
    pEl.style.top = "140px"
    cEl.style.left = "150px"
    p.notify()
    c.notify()
    await endOfTask()
    const R: Chain = [["p", pEl], ["r", rEl]]
    const C: Chain = [["p", pEl], ["r", rEl], ["c", cEl]]
    const read = () => offsetOf(sk, C, R)
    const first = frames(12, read)
    pEl.style.top = "40px"
    p.notify()
    await endOfTask()
    const run = [...first, read(), ...frames(240, read)]
    run.forEach((f, k) => expect(f.y, `frame ${k}: C's row in R`).toBeCloseTo(10, 6))
    expect(Math.abs(run[12]!.x - run[11]!.x), "no jump at the interrupt").toBeLessThan(Math.abs(run[11]!.x - run[10]!.x))
    expect(run.at(-1)!.x).toBeCloseTo(150, 3)
    e.dispose()
  })

  it("IR7: a node placed absolutely inside a layoutRoot restarts from where it paints when the root's FLIPping parent is sent back", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 40, 40, 300, 200)
    const rEl = makeBox(pEl, 10, 30, 260, 150)
    const cEl = makeBox(rEl, 10, 10, 20, 20)
    const p = register(e, "p", pEl)
    register(e, "r", rEl, {}, { layoutRoot: true })
    const c = register(e, "c", cEl, SLOW, { layoutAnchor: false })
    await endOfTask()
    fireFrame()
    pEl.style.top = "140px"
    cEl.style.left = "150px"
    p.notify()
    c.notify()
    await endOfTask()
    // C on the page: absolute, it flies there on its own, whatever R and P do.
    const C: Chain = [["p", pEl], ["r", rEl], ["c", cEl]]
    const read = () => painted(sk, C)
    const first = frames(12, read)
    pEl.style.top = "40px"
    p.notify()
    await endOfTask()
    const run = [...first, read(), ...frames(240, read)]
    const step = (k: number) => Math.hypot(run[k]!.x - run[k - 1]!.x, run[k]!.y - run[k - 1]!.y)
    expect(step(12), "no jump at the interrupt").toBeLessThan(step(11) + 1)
    expect(run.at(-1)).toEqual({ x: 200, y: 80 })
    e.dispose()
  })
})
