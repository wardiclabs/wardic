// The projection engine's depth order (#383): every top-down walk reads one order, ancestors first,
// cached until the tree or the node set changes, in place of a sort each frame.
//
// - DO1: a node disposed mid-flight leaves the order: it's never derived again, so nothing more is
//   written for it.
// - DO2: a node moved three levels deeper in the DOM is derived after its new ancestors once a
//   Measure pass sees it: while the root scales, its painted size stays its own in the pass's seed
//   frame and every frame after. Read in its old place, it would be derived before them, against
//   their last frame's deltas.
// - DO3: the order a parent and child were registered in doesn't change what's drawn: each moved in
//   one pass (the child inside its parent, as #144's SC2), registered parent first or child first,
//   they write the same frames, to floating-point rounding. The Measure pass seeds a child against its parent's new box, so
//   it must reach the parent first, whatever the set's order.
import * as Projection from "@wardic/core/Projection"
import type * as Box from "@wardic/core/Box"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)
afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

/** An absolutely positioned box in `parent`. */
const box = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "tween", duration: 0.5 }) })

const IDENTITY: Projection.Delta = {
  x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
}

/** `id`'s last written delta: the identity before any. */
const deltaOf = (sk: Sink, id: string): Projection.Delta =>
  Option.match(Option.fromUndefinedOr(sk.of(id).at(-1)), {
    onNone: () => IDENTITY,
    onSome: (w) => (w.value as unknown as { delta: Projection.Delta }).delta,
  })

/** `element`'s layout box against its stage: the fake sink paints nothing, so it's untransformed. */
const layoutBoxOf = (element: HTMLElement): Box.Box => {
  const at = element.getBoundingClientRect()
  const stageAt = (element.closest("[data-harness-stage]") as HTMLElement).getBoundingClientRect()
  return { x: { min: at.left - stageAt.left, max: at.right - stageAt.left }, y: { min: at.top - stageAt.top, max: at.bottom - stageAt.top } }
}

/** Where the last of `chain` paints: its layout box, every delta down the chain applied as CSS composes them. */
const paintedBox = (sk: Sink, chain: ReadonlyArray<readonly [string, HTMLElement]>): Box.Box =>
  Projection.applyTreeDeltas(layoutBoxOf(chain[chain.length - 1]![1]), Arr.map(chain, ([id]) => deltaOf(sk, id))).box

describe("the projection engine's depth order (#383)", () => {
  it("DO1: a node disposed mid-flight is never derived again", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = box(root, 40, 40, 300, 200)
    const cEl = box(pEl, 10, 10, 40, 40)
    const p = register(e, "p", pEl)
    const c = register(e, "c", cEl)
    await endOfTask()
    fireFrame()
    pEl.style.width = "500px"
    p.notify()
    await endOfTask()
    Arr.forEach(Arr.makeBy(5, () => 0), fireFrame)
    expect(sk.of("c").length, "the child rides its scaling parent: derived each frame").toBeGreaterThan(0)
    c.dispose()
    cEl.remove()
    const written = sk.of("c").length
    Arr.forEach(Arr.makeBy(10, () => 0), fireFrame)
    expect(sk.of("p").length, "the parent flies on").toBeGreaterThan(5)
    expect(sk.of("c").length, "nothing written for the disposed child").toBe(written)
    e.dispose()
  })

  it("DO2: a node moved three levels deeper is derived after its new ancestors: its painted size stays its own each frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const rEl = box(root, 0, 0, 300, 300)
    // X first, so it's earliest in the node set, at depth 1 under R.
    const xEl = box(rEl, 10, 10, 40, 40)
    const aEl = box(rEl, 60, 60, 200, 200)
    const bEl = box(aEl, 10, 10, 150, 150)
    const r = register(e, "r", rEl)
    const x = register(e, "x", xEl)
    register(e, "a", aEl)
    register(e, "b", bEl)
    await endOfTask()
    fireFrame()
    // X moves into B: depth 3, under A and B.
    bEl.append(xEl)
    x.notify()
    await endOfTask()
    fireFrame()
    // R grows: A, B and X ride it, each corrected for its ancestors' fresh scale.
    rEl.style.width = "600px"
    rEl.style.height = "600px"
    r.notify()
    await endOfTask()
    const chain = [["r", rEl], ["a", aEl], ["b", bEl], ["x", xEl]] as const
    // The Measure pass's seed frame, before any tick: derived in the same order.
    const seed = paintedBox(sk, chain)
    expect(Math.abs(deltaOf(sk, "r").x.scale - 1), "the seed frame scales R").toBeGreaterThan(0.05)
    expect(seed.x.max - seed.x.min, "the seed frame: width").toBeCloseTo(40, 1)
    expect(seed.y.max - seed.y.min, "the seed frame: height").toBeCloseTo(40, 1)
    const sizes = Arr.makeBy(20, () => {
      fireFrame()
      const painted = paintedBox(sk, chain)
      return { w: painted.x.max - painted.x.min, h: painted.y.max - painted.y.min, rScale: deltaOf(sk, "r").x.scale }
    })
    expect(Arr.some(sizes, (s) => Math.abs(s.rScale - 1) > 0.05), "R scales: its FLIP starts at 300 / 600").toBe(true)
    Arr.forEach(sizes, (s, k) => {
      expect(s.w, `frame ${k}: width`).toBeCloseTo(40, 1)
      expect(s.h, `frame ${k}: height`).toBeCloseTo(40, 1)
    })
    e.dispose()
  })

  it("DO3: registered parent first or child first, a parent and child moved in one pass write the same frames", async () => {
    /** The scene, registered in `order`: each frame's (p, c) translates and scales, the seed's first. */
    const run = async (order: "parent first" | "child first") => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const root = stage()
      const pEl = box(root, 40, 40, 300, 200)
      const cEl = box(pEl, 10, 40, 30, 30)
      const pair: ReadonlyArray<readonly [string, HTMLElement]> = Bool.match(order === "child first", {
        onTrue: () => [["c", cEl], ["p", pEl]],
        onFalse: () => [["p", pEl], ["c", cEl]],
      })
      const handles = Arr.map(pair, ([id, element]) => [id, register(e, id, element)] as const)
      const p = Option.getOrThrow(Arr.findFirst(handles, ([id]) => id === "p"))[1]
      await endOfTask()
      fireFrame()
      pEl.style.top = "140px"
      cEl.style.left = "200px"
      p.notify()
      await endOfTask()
      const read = () => Arr.map(["p", "c"], (id) => {
        const d = deltaOf(sk, id)
        return [d.x.translate, d.y.translate, d.x.scale, d.y.scale]
      })
      const frames = [read(), ...Arr.makeBy(40, () => {
        fireFrame()
        return read()
      })]
      e.dispose()
      clearStages()
      return frames
    }
    const parentFirst = await run("parent first")
    const childFirst = await run("child first")
    expect(parentFirst[1]![1]![0], "the child moves").not.toBe(0)
    // The same to floating-point rounding (~1e-13 px): an order the Measure pass got wrong is pixels off.
    const same = (a: ReadonlyArray<ReadonlyArray<number>>, b: ReadonlyArray<ReadonlyArray<number>>): boolean =>
      Arr.every(a, (values, n) => Arr.every(values, (v, i) => Math.abs(v - b[n]![i]!) < 1e-9))
    const differs = Arr.findFirstIndex(parentFirst, (frame, k) => Bool.not(same(frame, childFirst[k]!)))
    expect(Option.getOrUndefined(differs), `first different frame: ${JSON.stringify(Option.map(differs, (k) => [parentFirst[k], childFirst[k]]))}`).toBeUndefined()
  })
})

