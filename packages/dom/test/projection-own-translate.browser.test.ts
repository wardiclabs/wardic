// A twin's own translate in a handover (#363, ADR-0009 *Amendment (#363)*), checked against a fake
// ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`), as #8's own scale
// is (`projection-own-scale.browser.test.ts`). The renderer adds an element's own translate (`x`,
// `y`, `translate*`) to its projection's; a binding hands it to the node as `ownTranslate`. So:
//
// - XT1: a crossfade beside a live twin held at its own translate starts from where that twin is
//   drawn, and the twin, now a Follower, is drawn where its Lead is every frame (Motion's: the
//   Follower drawn with its Lead's values);
// - XT2: a promotion starts from where the unmounted Lead was drawn, its own translate included;
// - XT3: a new Lead carrying its own translate starts drawn on its twin, its translate taken back,
//   and moves into its own place, drawn there at rest;
// - XT4: a Switch seed from a twin already off the page is where that twin was drawn; XT4b, into a
//   twin carrying its own translate;
// - XT5: an own scale and an own translate together: drawn scaled about the box's centre, then
//   moved, and a handover starts from there.
//
// Before #363 the renderer drew no own translate, so none of this could show.
import { describe, expect, it } from "@effect/vitest"
import type * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
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
type Pair = { readonly x: number; readonly y: number }

const NONE: Pair = { x: 0, y: 0 }
const MOVED: Pair = { x: 30, y: -12 }
const ONE: Pair = { x: 1, y: 1 }

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "spring" }), ...opts })

/** An element's box as the page lays it out (the fake sink paints nothing). */
const layoutOf = (e: Element): Box.Box => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

/** `box` scaled about its centre by `s`, then moved by `t`: an own scale and translate, as the renderer draws them. */
const transformed = (box: Box.Box, t: Pair, s: Pair = ONE): Box.Box => {
  const cx = (box.x.min + box.x.max) / 2
  const cy = (box.y.min + box.y.max) / 2
  const hw = ((box.x.max - box.x.min) / 2) * s.x
  const hh = ((box.y.max - box.y.min) / 2) * s.y
  return { x: { min: cx - hw + t.x, max: cx + hw + t.x }, y: { min: cy - hh + t.y, max: cy + hh + t.y } }
}

const IDENTITY = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }

/** `id`'s delta as last written, the identity before any. */
const deltaOf = (sk: Sink, id: string): Projection.Delta => (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? IDENTITY

/** Where a top-level gate-driven node's projection puts it, through the fake sink. */
const projected = (e: Element, sk: Sink, id: string): Box.Box => Projection.applyTreeDeltas(layoutOf(e), [deltaOf(sk, id)]).box

/** Where a top-level gate-driven node is drawn: its projection, its own translate (and scale) on top. */
const drawn = (e: Element, sk: Sink, id: string, own: Pair, scale: Pair = ONE): Box.Box => transformed(projected(e, sk, id), own, scale)

/** How far apart two boxes are: their furthest edge. */
const apart = (a: Box.Box, b: Box.Box): number =>
  Math.max(Math.abs(a.x.min - b.x.min), Math.abs(a.x.max - b.x.max), Math.abs(a.y.min - b.y.min), Math.abs(a.y.max - b.y.max))

/** The start goes on from `before`: its first frame no further from it than its next step. */
const expectContinuous = (before: Box.Box, [first, second]: ReadonlyArray<Box.Box>, what: string) => {
  const step = apart(first!, second!)
  expect(apart(first!, before), `${what}: jump at the start (next step ${step.toFixed(2)}px)`).toBeLessThanOrEqual(step + 0.5)
}

const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

describe("a twin's own translate in a handover (#363)", () => {
  it("XT1: a crossfade beside a twin held at its own translate starts where it is drawn; the Follower is drawn on its Lead", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin", ownTranslate: () => MOVED })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", MOVED)
    expect(seen.x.min, "A drawn moved by its own x").toBeCloseTo(70, 1)
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", NONE), ...frames(1, () => drawn(bEl, sk, "b", NONE))], "B")
    // A, now a Follower: drawn where B is, every frame, its own translate taken back.
    const both = frames(30, () => ({ a: drawn(aEl, sk, "a", MOVED), b: drawn(bEl, sk, "b", NONE) }))
    for (const [i, f] of both.entries()) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(0.5)
    e.dispose()
  })

  it("XT2: a promotion starts from where the unmounted Lead was drawn, its own translate included", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 300, 60, 100, 80)
    const b = register(e, "b", bEl, { layoutId: "twin", ownTranslate: () => MOVED })
    await endOfTask()
    frames(120, () => undefined)
    const seen = drawn(bEl, sk, "b", MOVED)
    expect(seen.x.min, "B at rest, drawn moved by its own x").toBeCloseTo(330, 1)
    b.dispose()
    await endOfTask()
    expectContinuous(seen, frames(2, () => drawn(aEl, sk, "a", NONE)), "A")
    e.dispose()
  })

  it("XT3: a new Lead carrying its own translate starts drawn on its twin and moves into its own place", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", NONE)
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin", ownTranslate: () => MOVED })
    await endOfTask()
    const after = frames(120, () => ({ a: drawn(aEl, sk, "a", NONE), b: drawn(bEl, sk, "b", MOVED) }))
    expectContinuous(
      seen,
      after.map((f) => f.b),
      "B",
    )
    for (const [i, f] of after.slice(0, 30).entries()) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(0.5)
    // At rest at its own place, drawn moved by its own translate.
    expect(apart(after.at(-1)!.b, transformed(layoutOf(bEl), MOVED)), "B at rest").toBeLessThan(0.5)
    e.dispose()
  })

  it("XT4: a Switch seed from a twin already off the page is where that twin was drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    const a = register(e, "a", aEl, { layoutId: "twin", ownTranslate: () => MOVED })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", MOVED)
    // In one task: A's element leaves the page and its node is disposed; B mounts at 300.
    aEl.remove()
    a.dispose()
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", NONE), ...frames(1, () => drawn(bEl, sk, "b", NONE))], "B")
    e.dispose()
  })

  it("XT4b: a Switch into a twin carrying its own translate starts drawn on the seed", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    const a = register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", NONE)
    aEl.remove()
    a.dispose()
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin", ownTranslate: () => MOVED })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", MOVED), ...frames(1, () => drawn(bEl, sk, "b", MOVED))], "B")
    e.dispose()
  })

  it("XT5: an own scale and an own translate together: a handover starts from where the twin is drawn with both", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const half = { x: 1.5, y: 1.5 }
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin", ownTranslate: () => MOVED, ownScale: () => half })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", MOVED, half)
    expect(seen.x.max - seen.x.min, "A drawn at its own scale").toBeCloseTo(150, 1)
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", NONE), ...frames(1, () => drawn(bEl, sk, "b", NONE))], "B")
    const both = frames(20, () => ({ a: drawn(aEl, sk, "a", MOVED, half), b: drawn(bEl, sk, "b", NONE) }))
    for (const [i, f] of both.entries()) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(0.5)
    e.dispose()
  })
})
