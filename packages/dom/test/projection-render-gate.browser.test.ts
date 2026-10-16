// The render gate (#27, ADR-0009 *Amendment (#27)*), against a fake ProjectionSink with Refresh frames
// fired by hand: inside the coordinator's tick, a node whose value draws the same as its last write
// isn't written again.
//
// - RG1: a `layout` child riding a parent that only translates draws the same every frame (its own
//   delta is the identity; only its `originPoint` moves with the parent): written at most once over
//   the parent's flight, while the parent, whose translate changes, is written every frame.
// - RG2: a node whose value changes every frame (a FLIP of its own) is written every frame.
// - RG3–RG5: a value changing in one field alone is written every frame: a box centred vertically
//   growing taller (its y scale), a child under a parent that only widens (its tree scale's x), and a
//   Switch at an equal box whose twins differ only in rotation, opacity or radius (the blended
//   rotation, the Switch opacity, the corrected radius beside an unchanged value).
// - RG6: `drawsSame` counts every field the renderer reads, and not `originPoint`.
// (A Measure pass still writes every node it derives, so a seed is applied with its running ancestor:
// ADR-0018 decision 12, pinned in projection-measure-pass.)
import { describe, expect, it } from "@effect/vitest"
import * as Easing from "@wardic/core/Easing"
import { afterEach, beforeEach } from "vitest"
import type * as Projection from "@wardic/core/Projection"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { drawsSame } from "../src/internal/projection.ts"
import { clearStages, el, endOfTask, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(() => {
  stubFrames()
})

afterEach(() => {
  unstubFrames()
  clearStages()
})

/** A 0.3 s linear tween: 18 frames. */
const TWEEN: ProjectionSystem.LayoutTransition = { type: "tween", duration: 0.3, easing: Easing.linear }

describe("the render gate (#27)", () => {
  it("RG1: a layout child riding a parent that only translates is written at most once over the flight; the parent every frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:800px;height:400px")
    const parent = el(s, "position:absolute;left:0;top:0;width:200px;height:200px")
    const child = el(parent, "position:absolute;left:20px;top:20px;width:40px;height:40px")
    const hp = e.system.register({ id: "parent", element: parent, transition: () => Option.some(TWEEN) })
    e.system.register({ id: "child", element: child, transition: () => Option.some(TWEEN) })
    await endOfTask()
    fireFrame()
    parent.style.left = "300px"
    hp.notify()
    await endOfTask()
    const from = sk.writes.length
    fireFrames(17)
    const ticks = sk.writes.slice(from)
    expect(ticks.filter((w) => w.id === "parent"), "the parent: its translate changes every frame").toHaveLength(17)
    expect(ticks.filter((w) => w.id === "child").length, "the child: the same drawn value, not written again").toBeLessThanOrEqual(1)
    e.dispose()
  })

  it("RG2: a node whose value changes every frame is written every frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const a = el(stage("position:relative;width:800px;height:200px"), "position:absolute;left:0;top:0;width:50px;height:50px")
    const h = e.system.register({ id: "a", element: a, transition: () => Option.some(TWEEN) })
    await endOfTask()
    fireFrame()
    a.style.left = "300px"
    h.notify()
    await endOfTask()
    const from = sk.writes.length
    fireFrames(17)
    expect(sk.writes.slice(from).filter((w) => w.id === "a")).toHaveLength(17)
    e.dispose()
  })

  it("RG3: a box centred vertically growing taller, its y scale alone changing, is written every frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const a = el(stage("position:relative;width:800px;height:300px"), "position:absolute;left:0;top:50px;width:100px;height:100px")
    const h = e.system.register({ id: "a", element: a, transition: () => Option.some(TWEEN) })
    await endOfTask()
    fireFrame()
    // The same centre (100), taller: no translate either way, only the y scale eases back to 1.
    a.style.top = "25px"
    a.style.height = "150px"
    h.notify()
    await endOfTask()
    const from = sk.writes.length
    fireFrames(17)
    const writes = sk.writes.slice(from).filter((w) => w.id === "a")
    expect(writes.map((w) => w.ty).every((ty) => Math.abs(ty) < 1e-9), "no translate: the same centre").toBe(true)
    expect(writes).toHaveLength(17)
    e.dispose()
  })

  it("RG4: a child under a parent that only widens, its tree scale's x alone changing, is written every frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:800px;height:400px")
    const parent = el(s, "position:absolute;left:0;top:0;width:200px;height:200px")
    const child = el(parent, "position:absolute;left:20px;top:20px;width:40px;height:40px")
    const hp = e.system.register({ id: "parent", element: parent, transition: () => Option.some(TWEEN) })
    e.system.register({ id: "child", element: child, transition: () => Option.some(TWEEN) })
    await endOfTask()
    fireFrame()
    parent.style.width = "400px"
    hp.notify()
    await endOfTask()
    const from = sk.writes.length
    fireFrames(17)
    expect(sk.writes.slice(from).filter((w) => w.id === "child"), "counter-scaled every frame").toHaveLength(17)
    e.dispose()
  })

  it("RG5: a Switch at an equal box whose twins differ only in rotation, opacity or radius writes the Lead every frame of the blend", async () => {
    const looks: ReadonlyArray<readonly [string, Partial<ProjectionSystem.RegisterNodeOptions>, string]> = [
      ["rotation", { ownRotate: () => 30 }, ""],
      ["opacity", { ownOpacity: () => 0.4 }, ""],
      ["radius", {}, "border-radius:20px"],
    ]
    for (const [what, look, css] of looks) {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const root = stage("position:relative;width:800px;height:200px")
      const box = (extra: string) => el(root, `position:absolute;left:20px;top:40px;width:80px;height:40px;${extra}`)
      const aEl = box(css)
      const a = e.system.register({ id: "a", element: aEl, transition: () => Option.some(TWEEN), layoutId: `twin-${what}`, ...look })
      await endOfTask()
      fireFrame()
      aEl.remove()
      a.dispose()
      e.system.register({ id: "b", element: box(""), transition: () => Option.some(TWEEN), layoutId: `twin-${what}` })
      await endOfTask()
      const from = sk.writes.length
      fireFrames(8)
      expect(sk.writes.slice(from).filter((w) => w.id === "b"), `${what}: the Lead written every frame of the blend`).toHaveLength(8)
      e.dispose()
    }
  })

  it("RG6: drawsSame counts every field the renderer reads, and not originPoint", () => {
    const axis = { translate: 4, scale: 0.5, origin: 0.5, originPoint: 100 }
    const base: Projection.Value = { delta: { x: axis, y: axis }, treeScale: { x: 1, y: 1 }, opacity: 1, blendOpacity: 1, rotate: 0, raise: 1 }
    const withDelta = (dx: Partial<typeof axis>, dy: Partial<typeof axis>): Projection.Value => ({ ...base, delta: { x: { ...axis, ...dx }, y: { ...axis, ...dy } } })
    expect(drawsSame(base, { ...base }), "the same").toBe(true)
    expect(drawsSame(base, withDelta({ originPoint: 300 }, { originPoint: 300 })), "originPoint: the engine's own").toBe(true)
    const differs: ReadonlyArray<readonly [string, Projection.Value]> = [
      ["x translate", withDelta({ translate: 5 }, {})],
      ["y translate", withDelta({}, { translate: 5 })],
      ["x scale", withDelta({ scale: 0.6 }, {})],
      ["y scale", withDelta({}, { scale: 0.6 })],
      ["x origin", withDelta({ origin: 0 }, {})],
      ["y origin", withDelta({}, { origin: 0 })],
      ["tree scale x", { ...base, treeScale: { x: 2, y: 1 } }],
      ["tree scale y", { ...base, treeScale: { x: 1, y: 2 } }],
      ["opacity", { ...base, opacity: 0.5 }],
      ["blend opacity", { ...base, blendOpacity: 0.5 }],
      ["rotate", { ...base, rotate: 10 }],
      ["raise", { ...base, raise: 2 }],
      ["pointer pass-through", { ...base, passesPointer: true }],
    ]
    for (const [what, other] of differs) expect(drawsSame(base, other), what).toBe(false)
  })
})
