// A twin's own scale in a handover (#8, ADR-0010 *Amendment (#8)*), checked against a fake
// ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`). The renderer
// draws an element's own scale (`scale`, `scaleX`, `scaleY`) on top of its projection, about the
// projected box's centre; a binding hands it to the node as `ownScale`. So:
//
// - XS1: a crossfade beside a live twin held at its own scale starts from where that twin is
//   drawn, and the twin, now a Follower, is drawn where its Lead is every frame (Motion's: the
//   Follower drawn with its Lead's values);
// - XS2: a promotion starts from where the unmounted Lead was drawn, its own scale included;
// - XS2b: under presence, the promoted twin and the re-introduced leaver both go on from there;
// - XS3: a new Lead carrying its own scale starts drawn on its twin, its scale divided out, and
//   grows into it over the flight (Motion jumps here instead); XS3b, a promoted one;
// - XS4: a Switch seed from a twin already off the page is where that twin was drawn; XS4b, into
//   a twin carrying its own scale;
// - XS5: an axis at no own scale (a pop-in from nothing) has nothing to divide out: it starts from
//   the twin's box as it is, with no NaN.
//
// Before #8, XS1 to XS4 started from the twin's box without its own scale, and a Follower was drawn
// at its own scale around its Lead.
import { describe, expect, it } from "@effect/vitest"
import type * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>
type Scale = { readonly x: number; readonly y: number }

const ONE: Scale = { x: 1, y: 1 }
const ONE_AND_A_HALF: Scale = { x: 1.5, y: 1.5 }

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

/** An element's box as the page lays it out (the fake sink paints nothing). */
const layoutOf = (e: Element): Box.Box => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

/** `box` scaled about its centre: an own scale, as the renderer draws it. */
const scaled = (box: Box.Box, s: Scale): Box.Box => {
  const cx = (box.x.min + box.x.max) / 2
  const cy = (box.y.min + box.y.max) / 2
  const hw = ((box.x.max - box.x.min) / 2) * s.x
  const hh = ((box.y.max - box.y.min) / 2) * s.y
  return { x: { min: cx - hw, max: cx + hw }, y: { min: cy - hh, max: cy + hh } }
}

const IDENTITY = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }

/** `id`'s delta as last written, the identity before any. */
const deltaOf = (sk: Sink, id: string): Projection.Delta => (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? IDENTITY

/** Where a top-level gate-driven node's projection puts it, through the fake sink. */
const projected = (e: Element, sk: Sink, id: string): Box.Box => Projection.applyTreeDeltas(layoutOf(e), [deltaOf(sk, id)]).box

/** Where a top-level gate-driven node is drawn: its projection, its own scale on top. */
const drawn = (e: Element, sk: Sink, id: string, own: Scale): Box.Box => scaled(projected(e, sk, id), own)

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

describe("a twin's own scale in a handover (#8)", () => {
  it("XS1: a crossfade beside a twin held at its own scale starts where it is drawn; the Follower is drawn on its Lead", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", ONE_AND_A_HALF)
    expect(seen.x.max - seen.x.min, "A drawn at its own scale").toBeCloseTo(150, 1)
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", ONE), ...frames(1, () => drawn(bEl, sk, "b", ONE))], "B")
    // A, now a Follower: drawn where B is, every frame, its own scale set aside.
    const both = frames(30, () => ({ a: drawn(aEl, sk, "a", ONE_AND_A_HALF), b: drawn(bEl, sk, "b", ONE) }))
    for (const [i, f] of both.entries()) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(0.5)
    e.dispose()
  })

  it("XS2: a promotion starts from where the unmounted Lead was drawn, its own scale included", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 300, 60, 100, 80)
    const b = register(e, "b", bEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    frames(120, () => undefined)
    const seen = drawn(bEl, sk, "b", ONE_AND_A_HALF)
    expect(seen.x.max - seen.x.min, "B at rest, drawn at its own scale").toBeCloseTo(150, 1)
    b.dispose()
    await endOfTask()
    expectContinuous(seen, frames(2, () => drawn(aEl, sk, "a", ONE)), "A")
    e.dispose()
  })

  it("XS2b: under presence, the promoted twin and the re-introduced leaver both go on from where the leaver was drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 300, 60, 100, 80)
    const b = register(e, "b", bEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    frames(120, () => undefined)
    const seen = drawn(bEl, sk, "b", ONE_AND_A_HALF)
    queueMicrotask(() => {
      e.system.handleLeave(bEl, () => undefined)
    })
    b.dispose()
    await endOfTask()
    // A leaving node is committed to the page, with no own values: read it there.
    const after = frames(20, () => ({ a: drawn(aEl, sk, "a", ONE), b: layoutOf(bEl) }))
    expectContinuous(
      seen,
      after.map((f) => f.a),
      "A, promoted",
    )
    expectContinuous(
      seen,
      after.map((f) => f.b),
      "B, leaving",
    )
    for (const [i, f] of after.entries()) expect(apart(f.a, f.b), `frame ${i}: the leaver on its Lead`).toBeLessThan(0.5)
    e.dispose()
  })

  it("XS3: a new Lead carrying its own scale starts drawn on its twin and grows into its scale; the Follower rides it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", ONE)
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    const after = frames(120, () => ({ a: drawn(aEl, sk, "a", ONE), b: drawn(bEl, sk, "b", ONE_AND_A_HALF) }))
    expectContinuous(
      seen,
      after.map((f) => f.b),
      "B",
    )
    for (const [i, f] of after.slice(0, 30).entries()) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(0.5)
    // At rest at its own place, drawn at its own scale.
    expect(apart(after.at(-1)!.b, scaled(layoutOf(bEl), ONE_AND_A_HALF)), "B at rest").toBeLessThan(0.5)
    e.dispose()
  })

  it("XS3b: a promoted twin carrying its own scale starts drawn on the unmounted Lead", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 300, 60, 100, 80)
    const b = register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    frames(120, () => undefined)
    const seen = drawn(bEl, sk, "b", ONE)
    b.dispose()
    await endOfTask()
    const after = frames(120, () => drawn(aEl, sk, "a", ONE_AND_A_HALF))
    expectContinuous(seen, after, "A")
    expect(apart(after.at(-1)!, scaled(layoutOf(aEl), ONE_AND_A_HALF)), "A at rest at its own scale").toBeLessThan(0.5)
    e.dispose()
  })

  it("XS4: a Switch seed from a twin already off the page is where that twin was drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    const a = register(e, "a", aEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", ONE_AND_A_HALF)
    // In one task: A's element leaves the page and its node is disposed; B mounts at 300.
    aEl.remove()
    a.dispose()
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", ONE), ...frames(1, () => drawn(bEl, sk, "b", ONE))], "B")
    e.dispose()
  })

  it("XS4b: a Switch into a twin carrying its own scale starts drawn on the seed", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    const a = register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const seen = drawn(aEl, sk, "a", ONE)
    aEl.remove()
    a.dispose()
    const bEl = makeBox(root, 300, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin", ownScale: () => ONE_AND_A_HALF })
    await endOfTask()
    expectContinuous(seen, [drawn(bEl, sk, "b", ONE_AND_A_HALF), ...frames(1, () => drawn(bEl, sk, "b", ONE_AND_A_HALF))], "B")
    e.dispose()
  })

  it("XS5: an axis at no own scale starts from its twin's box as it is, with no NaN", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const twin = layoutOf(aEl)
    const bEl = makeBox(root, 300, 60, 100, 80)
    const popIn = { x: 0, y: 1 }
    register(e, "b", bEl, { layoutId: "twin", ownScale: () => popIn })
    await endOfTask()
    const after = frames(3, () => ({ projected: projected(bEl, sk, "b"), drawn: drawn(bEl, sk, "b", popIn), delta: deltaOf(sk, "b") }))
    for (const f of after) {
      for (const v of [f.delta.x.translate, f.delta.x.scale, f.delta.y.translate, f.delta.y.scale]) expect(Number.isFinite(v)).toBe(true)
    }
    // x: nothing divided out, its projection starts at the twin's x; y: drawn on the twin's.
    const axisX = (box: Box.Box): Box.Box => ({ x: box.x, y: twin.y })
    expectContinuous(
      twin,
      after.map((f) => axisX(f.projected)),
      "B's projection on x",
    )
    expectContinuous(
      twin,
      after.map((f) => ({ x: twin.x, y: f.drawn.y })),
      "B drawn on y",
    )
    e.dispose()
  })
})
