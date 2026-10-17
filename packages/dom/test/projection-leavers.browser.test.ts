// A just-disposed layout node, held until the end of its task (#221: one `Leaver` record a node,
// ADR-0010 *Amendment (#13)*, #169), checked against a fake ProjectionSink with every Refresh frame
// fired by hand (`projection-harness.ts`).
//
// - LV1: a twin that registered first and is still unmeasured when its other twin is disposed, in
//   the same task, takes the leaver's Switch seed straight away: its first frame paints at the
//   leaver's box. (Solid's register-then-dispose test measures the enterer while its twin is still
//   live, so it crossfades instead and never reaches the hand-off.)
// - LV2: a leaver lasts until the end of its task: a `handleLeave` in that task re-introduces it,
//   one a task later finds nothing.
// - LV3: a twin inside a re-introduced leaver whose own Lead isn't in a handover is left alone: it
//   doesn't come back as a node the leaver carries, as a plain layout node beside it does (#169).
import { describe, expect, it } from "@effect/vitest"
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
type Rect = { readonly x: { readonly min: number; readonly max: number }; readonly y: { readonly min: number; readonly max: number } }

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const drawnOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

const IDENTITY: Projection.Delta = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }

/** A gate-driven top-level node's painted box: its layout box through its last written delta. */
const paintedOf = (sk: Sink, id: string, e: HTMLElement): Rect => {
  const delta = sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined
  return Projection.applyTreeDeltas(drawnOf(e), [delta ?? IDENTITY]).box
}

const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.x.min - b.x.min), Math.abs(a.x.max - b.x.max), Math.abs(a.y.min - b.y.min), Math.abs(a.y.max - b.y.max))

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "spring" }), ...opts })

const settle = async (): Promise<void> => {
  await endOfTask()
  for (let i = 0; i < 120; i++) fireFrame()
}

/** Two twins of `layoutId`, a small one and a big one (the Lead), settled. */
const pair = async (e: Engine, layoutId: string) => {
  const root = stage()
  const small = makeBox(root, 20, 300, 60, 40)
  const smallHandle = register(e, "small", small, { layoutId })
  await settle()
  const big = makeBox(root, 300, 100, 200, 150)
  const bigHandle = register(e, "big", big, { layoutId })
  await settle()
  return { root, small, smallHandle, big, bigHandle }
}

describe("a just-disposed layout node, held until the end of its task (#221)", () => {
  it("LV1: a twin registered first and unmeasured takes the leaver's seed straight away: its first frame is at the leaver's box", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    const leaverBox = drawnOf(leaver)
    // In one task, before any Measure pass: the enterer registers, then its twin is disposed.
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    leaverHandle.dispose()
    leaver.remove()
    // The task's Measure pass writes the enterer's progress-0 frame.
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), leaverBox), "the first frame at the leaver's box, px").toBeLessThan(1)
    e.dispose()
  })

  it("LV2: a handleLeave in the leaver's task re-introduces it; one a task later finds nothing", async () => {
    const same = makeEngine(makeSink().sink)
    const a = await pair(same, "a")
    a.bigHandle.dispose()
    expect(same.system.handleLeave(a.big, () => {}), "in the same task").toBe(true)
    same.dispose()
    clearStages()

    const later = makeEngine(makeSink().sink)
    const b = await pair(later, "b")
    b.bigHandle.dispose()
    await endOfTask()
    expect(later.system.handleLeave(b.big, () => {}), "a task later: the leaver has expired").toBe(false)
    later.dispose()
  })

  it("LV3: a twin inside a re-introduced leaver, whose Lead isn't in a handover, isn't carried; a plain layout node beside it is", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const thumbA = makeBox(root, 20, 400, 60, 40)
    register(e, "thumbA", thumbA, { layoutId: "a" })
    await settle()
    // The wrapper, A's Lead, holds a twin of "b" (a Follower: its Lead registers after it) and a plain layout node.
    const wrap = makeBox(root, 300, 100, 300, 240)
    const wrapHandle = register(e, "wrap", wrap, { layoutId: "a" })
    const inner = makeBox(wrap, 20, 20, 60, 40)
    const innerHandle = register(e, "inner", inner, { layoutId: "b" })
    const plain = makeBox(wrap, 120, 20, 60, 40)
    const plainHandle = register(e, "plain", plain)
    const thumbB = makeBox(root, 20, 500, 60, 40)
    register(e, "thumbB", thumbB, { layoutId: "b" })
    await settle()
    // Solid disposes the wrapper's contents with it; presence then asks for the wrapper back, in the task.
    let back = false
    queueMicrotask(() => {
      back = e.system.handleLeave(wrap, () => {})
    })
    innerHandle.dispose()
    plainHandle.dispose()
    wrapHandle.dispose()
    await endOfTask()
    expect(back, "the wrapper comes back as A's Follower").toBe(true)
    const innerStyles: Array<string> = []
    const plainStyles: Array<string> = []
    for (let i = 0; i < 30; i++) {
      fireFrame()
      innerStyles.push(inner.style.transform)
      plainStyles.push(plain.style.transform)
    }
    // A node the leaver carries is written every frame (`none` at rest in it); one left alone, never.
    expect(innerStyles.every((t) => t === ""), "the inner twin is never written: its Lead isn't in a handover").toBe(true)
    expect(plainStyles.every((t) => t !== ""), "the plain layout node is carried").toBe(true)
    e.dispose()
  })
})
