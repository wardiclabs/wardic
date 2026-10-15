// The render gate (#27, ADR-0009 *Amendment (#27)*), against a fake ProjectionSink with Refresh frames
// fired by hand: inside the coordinator's tick, a node whose value draws the same as its last write
// isn't written again.
//
// - RG1: a `layout` child riding a parent that only translates draws the same every frame (its own
//   delta is the identity; only its `originPoint` moves with the parent): written at most once over
//   the parent's flight, while the parent, whose translate changes, is written every frame.
// - RG2: a node whose value changes every frame (a FLIP of its own) is written every frame.
// (A Measure pass still writes every node it derives, so a seed is applied with its running ancestor:
// ADR-0018 decision 12, pinned in projection-measure-pass.)
import { describe, expect, it } from "@effect/vitest"
import * as Easing from "@wardic/core/Easing"
import { afterEach, beforeEach } from "vitest"
import type { LayoutTransition } from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(() => {
  stubFrames()
})

afterEach(() => {
  unstubFrames()
  clearStages()
})

/** A 0.3 s linear tween: 18 frames. */
const TWEEN: LayoutTransition = { type: "tween", duration: 0.3, easing: Easing.linear }

describe("the render gate (#27)", () => {
  it("RG1: a layout child riding a parent that only translates is written at most once over the flight; the parent every frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:800px;height:400px")
    const parent = el(s, "position:absolute;left:0;top:0;width:200px;height:200px")
    const child = el(parent, "position:absolute;left:20px;top:20px;width:40px;height:40px")
    const hp = e.system.register({ id: "parent", element: parent, transition: () => TWEEN })
    e.system.register({ id: "child", element: child, transition: () => TWEEN })
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
    const h = e.system.register({ id: "a", element: a, transition: () => TWEEN })
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
})
