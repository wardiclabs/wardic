// A window resize blocks the next Measure pass (ADR-0018, *Amendment (#39)*), checked
// against a fake ProjectionSink with Refresh frames fired by hand and real viewport
// changes (`page.viewport`, which resizes the test iframe and fires `resize`).
//
// A change of `window.innerWidth` finishes running layout animations and blocks the next
// pass within 250 ms: every node gets a slot-only update (fresh boxes, nothing seeded),
// and the pass clears the block. If none runs, the engine runs one itself at 250 ms; a
// drag that starts while boxes are stale runs it first. A height-only change does
// nothing. Before, nothing re-measured on a resize, so the next pass animated every node
// from its box before the resize (#39).
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import { page } from "vitest/browser"
import type { ProjectionNodeHandle } from "../src/index.ts"
import { clearStages, el, endOfTask, type Engine, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames, wait } from "./projection-harness.ts"

let width = 0
let height = 0

beforeEach(() => {
  stubFrames()
  width = window.innerWidth
  height = window.innerHeight
})
afterEach(async () => {
  unstubFrames()
  clearStages()
  await page.viewport(width, height)
  await wait(50)
})

/** Narrow the window by `by` px and let the resize event arrive. */
const narrow = async (by = 200): Promise<void> => {
  await page.viewport(width - by, height)
  await wait(50)
}

/** A centred 200 px column of `n` 50 px items (10 px apart): a width change moves it sideways. */
const centredColumn = (n: number): Array<HTMLElement> => {
  const col = el(stage(), "position:relative;margin:0 auto;width:200px")
  return Array.from({ length: n }, () => el(col, "width:200px;height:50px;margin-bottom:10px"))
}

const mount = async (e: Engine, els: ReadonlyArray<HTMLElement>, extra: { raiseWhileDragged?: boolean } = {}) => {
  const handles: Array<ProjectionNodeHandle> = els.map((element, i) =>
    e.system.register({ id: `n${i}`, element, springOptions: () => ({}), ...extra }),
  )
  await endOfTask()
  fireFrame()
  return handles
}

const passAfter = async (e: Engine, trigger: () => void) => {
  const before = e.spans.length
  trigger()
  await endOfTask()
  return e.spans[before]
}

describe("a window resize blocks the next Measure pass (ADR-0018, Amendment (#39))", () => {
  it("RB1: the first pass after a width change seeds nothing and is marked blocked; boxes are fresh after it", async () => {
    const e = makeEngine(makeSink().sink)
    const handles = await mount(e, centredColumn(5))
    await narrow()
    const blocked = await passAfter(e, () => handles[0]!.notify())
    expect(blocked?.seeded).toBe(0)
    expect(blocked?.blocked).toBe(true)
    const next = await passAfter(e, () => handles[0]!.notify())
    expect(next?.seeded).toBe(0)
    expect(next?.blocked).not.toBe(true)
    e.dispose()
  })

  it("RB2: a reorder after a resize (#39's case) animates only the two items that moved", async () => {
    const e = makeEngine(makeSink().sink)
    const els = centredColumn(5)
    const handles = await mount(e, els)
    await narrow()
    await wait(300) // the block's own pass has run by now
    els[1]!.parentElement!.insertBefore(els[2]!, els[1]!)
    const pass = await passAfter(e, () => handles[0]!.notify())
    expect(pass?.seeded).toBe(2)
    e.dispose()
  })

  it("RB3: with no trigger, the engine runs the blocked pass itself about 250 ms after the change", async () => {
    const e = makeEngine(makeSink().sink)
    const handles = await mount(e, centredColumn(5))
    const before = e.spans.length
    await narrow()
    await wait(350)
    const own = e.spans.slice(before)
    expect(own.filter((s) => s.blocked === true)).toHaveLength(1)
    const next = await passAfter(e, () => handles[0]!.notify())
    expect(next?.seeded).toBe(0)
    e.dispose()
  })

  it("RB4 (guard): a height-only change blocks nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const els = centredColumn(5)
    const handles = await mount(e, els)
    await page.viewport(width, height - 150)
    await wait(50)
    els[0]!.style.marginBottom = "30px" // a real change: every item below moves 20 px
    const pass = await passAfter(e, () => handles[0]!.notify())
    expect(pass?.blocked).not.toBe(true)
    expect(pass?.seeded).toBe(4)
    e.dispose()
  })

  it("RB5: a width change finishes a running FLIP and a flight back: both snap to their slots", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const els = centredColumn(3)
    const [a, , c] = await mount(e, els)
    // a FLIPs slowly (its box moves 40 px down); c is released 80 px from its slot.
    els[0]!.style.marginTop = "40px"
    a!.notify()
    await endOfTask()
    fireFrames(2)
    c!.dragStart()
    c!.dragMove({ x: 80, y: 0 })
    c!.dragEnd()
    await endOfTask()
    fireFrames(2)
    await narrow()
    const last = (id: string) => sk.of(id).at(-1)!
    expect(Math.abs(last("n0").tx) + Math.abs(last("n0").ty), "a at its slot").toBeLessThan(0.01)
    expect(Math.abs(last("n2").tx) + Math.abs(last("n2").ty), "c at its slot").toBeLessThan(0.01)
    const count = sk.writes.length
    fireFrames(10)
    expect(sk.writes.length, "nothing still animating").toBe(count)
    e.dispose()
  })

  it("RB6: a dragged node keeps following the pointer through a width change", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const els = centredColumn(3)
    const [, b] = await mount(e, els)
    const grab = els[1]!.getBoundingClientRect()
    b!.dragStart()
    b!.dragMove({ x: 30, y: 0 })
    await narrow()
    await wait(300)
    b!.dragMove({ x: 40, y: 0 })
    const painted = els[1]!.getBoundingClientRect().left + sk.of("n1").at(-1)!.tx
    expect(Math.abs(painted - (grab.left + 40))).toBeLessThan(1)
    e.dispose()
  })

  it("RB7: a drag started just after a width change grabs the post-resize slot (a mid-drag pass keeps it under the pointer)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const els = centredColumn(3)
    const [a, b] = await mount(e, els)
    await narrow()
    const grab = els[1]!.getBoundingClientRect()
    b!.dragStart()
    b!.dragMove({ x: 0, y: 20 })
    // A pass mid-drag (another item's change) re-reads b's slot.
    els[2]!.style.marginTop = "5px"
    a!.notify()
    await endOfTask()
    b!.dragMove({ x: 0, y: 20 })
    const r = els[1]!.getBoundingClientRect()
    const w = sk.of("n1").at(-1)!
    expect(Math.abs(r.left + w.tx - grab.left), "x").toBeLessThan(1)
    expect(Math.abs(r.top + w.ty - (grab.top + 20)), "y").toBeLessThan(1)
    e.dispose()
  })

  it("RB8: a burst of width changes ends in one blocked pass of the engine's own", async () => {
    const e = makeEngine(makeSink().sink)
    await mount(e, centredColumn(5))
    const before = e.spans.length
    for (let k = 0; k < 5; k++) {
      await page.viewport(width - 40 * (k + 1), height)
      await wait(30)
    }
    await wait(350)
    const own = e.spans.slice(before)
    expect(own).toHaveLength(1)
    expect(own[0]?.blocked).toBe(true)
    e.dispose()
  })

  it("RB9: the finish logs once, and dispose cancels the pending blocked pass", async () => {
    const e = makeEngine(makeSink().sink)
    const els = centredColumn(3)
    const [a] = await mount(e, els)
    els[0]!.style.marginTop = "40px"
    a!.notify()
    await endOfTask()
    fireFrames(2)
    await narrow()
    expect(e.logs.filter((l) => l.message.includes("resize finish"))).toHaveLength(1)
    const spans = e.spans.length
    e.dispose()
    await wait(350)
    expect(e.spans).toHaveLength(spans)
  })
})
