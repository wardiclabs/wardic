// A scroll root switching is a change of frame, not a move (#7, ADR-0012 *Amendment (#7)*, Motion's
// `wasRoot`), checked against a fake ProjectionSink with every Refresh frame fired by hand
// (`projection-harness.ts`), the page scrolled 300px. A `position: fixed` element's subtree folds in
// no outer scroll, so an element switching to or from it without moving on screen changes which
// scroll its nodes' boxes carry: before #7 that read as a move the page scroll's length.
//
// - SR1: a `layoutScroll` container switching to fixed and back, in place: it and its child stay;
// - SR2: a plain `layout` node switching to fixed in place;
// - SR3: an ancestor that isn't a node switching to fixed, a node inside;
// - SR4: after the switch, the page scrolls and a pass runs: nothing moves (its `position` used to
//   be read once, so a switched element's frame went stale);
// - SR5: a real move with the switch still animates, from where it was drawn;
// - SR6: mid-flight, the switch carries the flight too: a container flying sideways switches to
//   fixed in place, and it goes on, its child on it; sent on again, it restarts from where it's drawn.
import { describe, expect, it } from "@effect/vitest"
import type * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
import { afterEach, beforeEach } from "vitest"
import type { ProjectionNodeHandle, RegisterNodeOptions } from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  window.scrollTo(0, 0)
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, springOptions: () => ({}), ...opts })

const layoutOf = (e: Element): Box.Box => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}
const IDENTITY = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }
const deltaOf = (sk: Sink, id: string): Projection.Delta => (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? IDENTITY

/** Where a node's top is drawn, through the fake sink: its layout, then its ancestors' deltas and its own. */
const topOf = (e: Element, sk: Sink, ids: ReadonlyArray<string>): number =>
  Projection.applyTreeDeltas(layoutOf(e), ids.map((id) => deltaOf(sk, id))).box.y.min

const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

const FIXED_AT_TOP = "position:fixed;top:0px;left:40px;width:200px;height:100px"
const AT_300 = "position:absolute;top:300px;left:40px;width:200px;height:100px"

describe("a scroll root switching is a change of frame, not a move (#7)", () => {
  for (const [from, to, name] of [[AT_300, FIXED_AT_TOP, "to fixed"], [FIXED_AT_TOP, AT_300, "back from fixed"]] as const) {
    it(`SR1: a layoutScroll container switching ${name} in place, page scrolled: it and its child stay`, async () => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const root = stage("position:relative;width:100%;height:3000px")
      const box = el(root, `${from};overflow:auto`)
      const b = register(e, "box", box, { layoutScroll: true })
      const child = el(box, "position:absolute;top:20px;left:20px;width:60px;height:40px")
      const c = register(e, "c", child)
      await endOfTask()
      fireFrame()
      window.scrollTo(0, 300)
      await endOfTask()
      fireFrame()
      const [box0, child0] = [topOf(box, sk, ["box"]), topOf(child, sk, ["box", "c"])]
      box.style.cssText = `${to};overflow:auto`
      b.notify()
      c.notify()
      await endOfTask()
      for (const [i, f] of frames(6, () => [topOf(box, sk, ["box"]), topOf(child, sk, ["box", "c"])]).entries()) {
        expect(f[0]! - box0, `frame ${i}: the container`).toBeCloseTo(0, 1)
        expect(f[1]! - child0, `frame ${i}: its child`).toBeCloseTo(0, 1)
      }
      e.dispose()
    })
  }

  it("SR2: a plain layout node switching to fixed in place, page scrolled: it stays", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    const node = el(root, AT_300)
    const n = register(e, "n", node)
    await endOfTask()
    fireFrame()
    window.scrollTo(0, 300)
    await endOfTask()
    fireFrame()
    const top0 = topOf(node, sk, ["n"])
    node.style.cssText = FIXED_AT_TOP
    n.notify()
    await endOfTask()
    for (const [i, t] of frames(6, () => topOf(node, sk, ["n"])).entries()) expect(t - top0, `frame ${i}`).toBeCloseTo(0, 1)
    e.dispose()
  })

  it("SR3: an ancestor that isn't a node switching to fixed in place: the node inside stays", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    const bar = el(root, AT_300)
    const node = el(bar, "position:absolute;top:20px;left:20px;width:60px;height:40px")
    const n = register(e, "n", node)
    await endOfTask()
    fireFrame()
    window.scrollTo(0, 300)
    await endOfTask()
    fireFrame()
    const top0 = topOf(node, sk, ["n"])
    bar.style.cssText = FIXED_AT_TOP
    n.notify()
    await endOfTask()
    for (const [i, t] of frames(6, () => topOf(node, sk, ["n"])).entries()) expect(t - top0, `frame ${i}`).toBeCloseTo(0, 1)
    e.dispose()
  })

  it("SR4: after the switch, the page scrolls and a pass runs: nothing moves", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    const bar = el(root, AT_300)
    const node = el(bar, "position:absolute;top:20px;left:20px;width:60px;height:40px")
    const n = register(e, "n", node)
    await endOfTask()
    fireFrame()
    window.scrollTo(0, 300)
    bar.style.cssText = FIXED_AT_TOP
    n.notify()
    await endOfTask()
    frames(120, () => undefined)
    // Fixed now: the page scrolls under it, and the next pass reads it where it was.
    window.scrollTo(0, 500)
    const top0 = topOf(node, sk, ["n"])
    n.notify()
    await endOfTask()
    for (const [i, t] of frames(6, () => topOf(node, sk, ["n"])).entries()) expect(t - top0, `frame ${i}`).toBeCloseTo(0, 1)
    e.dispose()
  })

  it("SR5: a real move with the switch still animates, from where it was drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    const box = el(root, `${AT_300};overflow:auto`)
    const b = register(e, "box", box, { layoutScroll: true })
    await endOfTask()
    fireFrame()
    window.scrollTo(0, 300)
    await endOfTask()
    fireFrame()
    const top0 = topOf(box, sk, ["box"])
    // Fixed 100px lower on screen than it was drawn.
    box.style.cssText = "position:fixed;top:100px;left:40px;width:200px;height:100px;overflow:auto"
    b.notify()
    await endOfTask()
    const seen = frames(120, () => topOf(box, sk, ["box"]) - top0)
    expect(seen[0]!, "goes on from where it was drawn").toBeLessThan(seen[1]! + 0.5)
    expect(seen[0]!).toBeLessThan(10)
    expect(seen.at(-1)!, "at its new place").toBeCloseTo(100, 0)
    e.dispose()
  })

  it("SR6: mid-flight, the switch carries the flight: the container goes on sideways, its child on it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    const box = el(root, `${AT_300};overflow:auto`)
    const b = register(e, "box", box, { layoutScroll: true })
    const child = el(box, "position:absolute;top:20px;left:20px;width:60px;height:40px")
    register(e, "c", child)
    await endOfTask()
    fireFrame()
    window.scrollTo(0, 300)
    await endOfTask()
    fireFrame()
    // It flies 200px right, and the child, at rest inside it, rides it.
    box.style.left = "240px"
    b.notify()
    await endOfTask()
    frames(6, () => undefined)
    const at = () => ({ box: topOf(box, sk, ["box"]), boxX: Projection.applyTreeDeltas(layoutOf(box), [deltaOf(sk, "box")]).box.x.min, child: topOf(child, sk, ["box", "c"]) })
    const before = at()
    // Mid-flight it goes fixed where it is on screen.
    box.style.cssText = "position:fixed;top:0px;left:240px;width:200px;height:100px;overflow:auto"
    b.notify()
    await endOfTask()
    const after = frames(3, at)
    for (const [i, f] of after.entries()) {
      expect(f.box - before.box, `frame ${i}: the container's top`).toBeCloseTo(0, 1)
      expect(f.child - before.child, `frame ${i}: its child's top`).toBeCloseTo(0, 1)
    }
    expect(after[0]!.boxX - before.boxX, "it goes on sideways").toBeGreaterThan(0)
    expect(after[0]!.boxX - before.boxX).toBeLessThan(40)
    // Still flying, it's sent on again (#146): it restarts from where it's drawn, in its new frame.
    const seen = at()
    box.style.left = "340px"
    b.notify()
    await endOfTask()
    const again = frames(2, at)
    expect(again[0]!.box - seen.box, "a restart: no jump on y").toBeCloseTo(0, 1)
    expect(again[0]!.child - seen.child, "nor its child").toBeCloseTo(0, 1)
    e.dispose()
  })
})
