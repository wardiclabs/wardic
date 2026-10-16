// A `display: contents` layout node has no box (#9, ADR-0009 *Amendment (#9)*, Motion's skip in
// `applyTreeDeltas`), checked against a fake ProjectionSink with every Refresh frame fired by hand
// (`projection-harness.ts`). Its rect is 0x0 at the viewport's origin, so a scroll between passes
// read as a move: before #9 it animated the scroll's distance, and the node inside it with it.
//
// - DC1: the page scrolled between passes: the node writes no delta, and the one inside it moves
//   from where it was, as under a plain block. CSS applies no transform to a `display: contents`
//   element, so the one inside is drawn by its own delta alone: before #9 that delta corrected for
//   the node's scroll-length move, which never showed, and threw it 292px down;
// - DC2: switched back to `block`, it's a box again: its next pass is a first measure, with nothing
//   to animate from, and a later change animates.
import { describe, expect, it } from "@effect/vitest"
import type * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  window.scrollTo(0, 0)
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

const layoutOf = (e: Element): Box.Box => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

const IDENTITY = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }
const deltaOf = (sk: Sink, id: string): Projection.Delta => (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? IDENTITY
const isIdentity = (d: Projection.Delta): boolean => d.x.translate === 0 && d.y.translate === 0 && d.x.scale === 1 && d.y.scale === 1

const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

describe("a display: contents layout node has no box (#9)", () => {
  it("DC1: the page scrolled between passes, the node inside moves from where it was", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    const pEl = el(root, "display:contents")
    register(e, "p", pEl)
    const cEl = el(pEl, "position:absolute;left:20px;top:600px;width:60px;height:40px")
    const c = register(e, "c", cEl)
    await endOfTask()
    fireFrame()
    window.scrollTo(0, 300)
    const before = layoutOf(cEl)
    cEl.style.left = "200px"
    c.notify()
    await endOfTask()
    // The node's own transform never shows (it has no box): the child is drawn by its delta alone.
    const painted = frames(4, () => Projection.applyTreeDeltas(layoutOf(cEl), [deltaOf(sk, "c")]).box)
    const [first, second] = [painted[0]!, painted[1]!]
    expect(Math.abs(first.y.min - before.y.min), "no jump on y").toBeLessThan(0.5)
    expect(Math.abs(first.x.min - before.x.min), "x goes on from where it was").toBeLessThanOrEqual(Math.abs(second.x.min - first.x.min) + 0.5)
    for (const w of sk.of("p")) expect(isIdentity(w.value.delta as Projection.Delta), "the boxless node carries no delta").toBe(true)
    e.dispose()
  })

  it("DC2: switched back to block, it's a box again: a first measure, then a change animates", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:600px")
    const pEl = el(root, "display:contents")
    const p = register(e, "p", pEl)
    el(pEl, "width:60px;height:40px")
    await endOfTask()
    fireFrame()
    // Back to a block: its next pass measures it with nothing to animate from.
    pEl.style.cssText = "display:block;width:200px;height:40px"
    p.notify()
    await endOfTask()
    for (const d of frames(3, () => deltaOf(sk, "p"))) expect(isIdentity(d), "a first measure: no animation").toBe(true)
    // A real change now animates.
    pEl.style.width = "400px"
    p.notify()
    await endOfTask()
    const moving = frames(3, () => deltaOf(sk, "p"))
    expect(moving.some((d) => !isIdentity(d)), "a box again: its change animates").toBe(true)
    e.dispose()
  })
})
