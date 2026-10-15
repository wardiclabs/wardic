// The shared ResizeObserver's deliveries (#21, ADR-0018 *Amendment (#21)*), with the real observer and
// real frames (unlike projection-harness's other users, which stub both): a delivery runs a Measure pass
// only when it reports a size the engine hasn't measured. The engine observes the border box, which is
// what it measures, and counts an entry as measured only on a horizontal match within 0.01 px.
//
// - RS1: a mount runs one pass: the observer's first delivery reports the sizes it just measured.
// - RS2: a triggered size change runs one pass: the observer's echo of the new size runs none.
// - RS3: a size change between `observe()` and the first delivery, with no trigger, still runs a pass,
//   which animates it; so does a later change of the height alone.
// - RS4: an element mounted at 0×0 (no first delivery) that then grows, with no trigger, runs a pass.
// - RS5: a padding change, with no trigger, runs a pass: the border box changed (the content box,
//   watched before, didn't).
// - RS6: a vertical writing mode (inline is height) falls back to running the pass, and so does a
//   resize under an ancestor that scales the element without being a node.
import { describe, expect, it } from "@effect/vitest"
import { afterEach } from "vitest"
import { clearStages, el, endOfTask, type Engine, makeEngine, makeSink, stage, wait } from "./projection-harness.ts"

afterEach(() => {
  clearStages()
})

/** Long enough for the observer's delivery and the pass it may queue (several real frames). */
const SETTLE_MS = 150

const passesOf = (e: Engine): number => e.spans.length

describe("the shared ResizeObserver runs a pass only for a size the engine hasn't measured (#21)", () => {
  it("RS1: a mount runs one pass: the first delivery reports the sizes just measured", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage("position:relative;width:600px;height:300px")
    for (let i = 0; i < 3; i++) e.system.register({ id: `n${i}`, element: el(s, `width:${50 + i * 10}px;height:30px`), transition: () => ({ type: "spring" }) })
    await wait(SETTLE_MS)
    expect(passesOf(e)).toBe(1)
    e.dispose()
  })

  it("RS2: a triggered size change runs one pass: the observer's echo of it runs none", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage("position:relative;width:600px;height:300px"), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: () => ({ type: "spring" }) })
    await wait(SETTLE_MS)
    const before = passesOf(e)
    a.style.width = "120px"
    h.notify()
    await wait(SETTLE_MS)
    expect(passesOf(e) - before).toBe(1)
    expect(e.spans.at(-1)?.seeded).toBe(1)
    e.dispose()
  })

  it("RS3: a size change between observe() and the first delivery, with no trigger, still runs a pass that animates it; so does a height change", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage("position:relative;width:600px;height:300px"), "width:50px;height:30px")
    e.system.register({ id: "a", element: a, transition: () => ({ type: "spring" }) })
    await endOfTask() // the first pass has measured 50 px
    a.style.width = "120px" // before the observer's first delivery
    await wait(SETTLE_MS)
    expect(passesOf(e)).toBe(2)
    expect(e.spans.at(-1)?.seeded, "animated from 50 px").toBe(1)
    // A later change of the height alone, with no trigger, runs one too.
    a.style.height = "60px"
    await wait(SETTLE_MS)
    expect(passesOf(e)).toBe(3)
    e.dispose()
  })

  it("RS4: an element mounted at 0×0 that then grows, with no trigger, runs a pass", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage("position:relative;width:600px;height:300px"), "width:0px;height:0px")
    e.system.register({ id: "a", element: a, transition: () => ({ type: "spring" }) })
    await wait(SETTLE_MS)
    const before = passesOf(e)
    a.style.width = "80px"
    a.style.height = "40px"
    await wait(SETTLE_MS)
    expect(passesOf(e) - before).toBe(1)
    e.dispose()
  })

  it("RS5: a padding change, with no trigger, runs a pass: the border box the engine measures changed", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage("position:relative;width:600px;height:300px"), "width:50px;height:30px;box-sizing:content-box")
    e.system.register({ id: "a", element: a, transition: () => ({ type: "spring" }) })
    await wait(SETTLE_MS)
    const before = passesOf(e)
    a.style.padding = "10px"
    await wait(SETTLE_MS)
    expect(passesOf(e) - before).toBe(1)
    expect(e.spans.at(-1)?.seeded, "the box grew 20 px each way: it animates").toBe(1)
    e.dispose()
  })

  it("RS6: a vertical writing mode falls back to the pass, and so does a resize under a scaling ancestor that isn't a node", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage("position:relative;width:600px;height:300px")
    e.system.register({ id: "v", element: el(s, "width:100px;height:40px;writing-mode:vertical-rl"), transition: () => ({ type: "spring" }) })
    await wait(SETTLE_MS)
    expect(passesOf(e), "inline is height there: no horizontal match, so the pass runs").toBe(2)
    e.dispose()

    const e2 = makeEngine(makeSink().sink)
    const scaled = el(stage("position:relative;width:600px;height:300px"), "transform:scale(2);transform-origin:0 0")
    const b = el(scaled, "width:50px;height:30px")
    e2.system.register({ id: "b", element: b, transition: () => ({ type: "spring" }) })
    await wait(SETTLE_MS)
    const before = passesOf(e2)
    b.style.width = "70px" // no trigger: only the observer sees it
    await wait(SETTLE_MS)
    expect(passesOf(e2) - before, "the resize still runs a pass").toBe(1)
    e2.dispose()
  })
})
