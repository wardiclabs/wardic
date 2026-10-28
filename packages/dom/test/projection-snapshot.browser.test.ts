// The projection engine's tree as plain data (#384): `toJSON()`, Effect's `Inspectable`, for a
// diagnostic read. The layout lab draws it.
//
// - SN1: after a Measure pass, each node has its parent by DOM ancestry, its tag and `layoutRoot`,
//   and a `layoutId` pair names its Lead (the newest) and its Follower, with the Follower's Lead.
// - SN2: the flags follow what a node does: animating through a layout change and not once it
//   lands; dragging while dragged; releasing once let go, and not once its Release offset rests.
// - SN3: `String(system)` shows the tree, as an `Inspectable` does.
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearStages, el, endOfTask, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)
afterEach(() => {
  unstubFrames()
  clearStages()
})

type Engine = ReturnType<typeof makeEngine>

const TWEEN = Option.some({ type: "tween", duration: 0.2 } as const)

const register = (e: Engine, id: string, element: HTMLElement, more: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => TWEEN, ...more })

const box = (parent: HTMLElement, left: number, top: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:40px;height:40px`)

/** `id`'s entry in the system's tree now. */
const nodeOf = (e: Engine, id: string): ProjectionSystem.NodeSnapshot => {
  const found = Arr.findFirst(e.system.toJSON().nodes, (node) => node.id === id)
  if (Option.isNone(found)) throw new Error(`no node ${id}`)
  return found.value
}

describe("the projection engine's tree as plain data (#384)", () => {
  it("SN1: each node's parent, tag and layoutRoot, and a layoutId pair's Lead and Follower", async () => {
    const e = makeEngine(makeSink().sink)
    const root = stage()
    const rootEl = el(root, "position:relative;width:400px;height:300px")
    register(e, "root", rootEl, { layoutRoot: true })
    register(e, "child", box(rootEl, 10, 10))
    register(e, "a", box(rootEl, 100, 10), { layoutId: "hero" })
    await endOfTask()
    fireFrame()
    register(e, "b", box(root, 200, 200), { layoutId: "hero" })
    await endOfTask()
    fireFrame()
    const tree = e.system.toJSON()
    expect(tree._id).toBe("ProjectionSystem")
    expect(Arr.map(tree.nodes, (node) => node.id)).toEqual(["root", "child", "a", "b"])
    expect(nodeOf(e, "root")).toMatchObject({ tag: "div", parent: undefined, layoutRoot: true, layoutId: undefined, twin: undefined, lead: undefined })
    expect(nodeOf(e, "child")).toMatchObject({ parent: "root", layoutRoot: false, twin: undefined })
    expect(nodeOf(e, "a")).toMatchObject({ parent: "root", layoutId: "hero", twin: "follower", lead: "b" })
    expect(nodeOf(e, "b")).toMatchObject({ parent: undefined, layoutId: "hero", twin: "lead", lead: undefined })
    e.dispose()
  })

  it("SN2: animating, dragging and releasing follow what the node does", async () => {
    const e = makeEngine(makeSink().sink)
    const element = box(stage(), 0, 0)
    const node = register(e, "x", element)
    await endOfTask()
    fireFrame()
    expect(nodeOf(e, "x")).toMatchObject({ animating: false, dragging: false, releasing: false, leaving: false })
    element.style.left = "200px"
    node.notify()
    await endOfTask()
    fireFrame()
    expect(nodeOf(e, "x").animating, "a layout change in flight").toBe(true)
    fireFrames(40)
    await endOfTask()
    expect(nodeOf(e, "x").animating, "landed").toBe(false)
    node.dragStart()
    node.dragMove({ x: 60, y: 0 })
    fireFrame()
    expect(nodeOf(e, "x")).toMatchObject({ dragging: true, releasing: false })
    // Let go with no velocity: its Release offset springs back from 60.
    node.dragEnd()
    fireFrame()
    expect(nodeOf(e, "x")).toMatchObject({ dragging: false, releasing: true })
    let frames = 0
    while (nodeOf(e, "x").releasing && frames < 600) {
      fireFrame()
      await endOfTask()
      frames++
    }
    expect(nodeOf(e, "x").releasing, `the release came to rest (${frames} frames)`).toBe(false)
    e.dispose()
  })

  it("SN3: String(system) shows the tree", async () => {
    const e = makeEngine(makeSink().sink)
    register(e, "shown", box(stage(), 0, 0), { layoutId: "card" })
    await endOfTask()
    fireFrame()
    const text = String(e.system)
    expect(text).toContain('"_id":"ProjectionSystem"')
    expect(text).toContain('"id":"shown"')
    expect(text).toContain('"twin":"lead"')
    e.dispose()
  })
})
