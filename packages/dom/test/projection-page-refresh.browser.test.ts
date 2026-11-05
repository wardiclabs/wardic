// The page-size refresh (#261, ADR-0018 *Amendment (#261)*), with the real observer and real frames
// (as projection-observer's): the engine watches the page's content (the body and its direct children,
// #239's watch) on its shared ResizeObserver, and when it changes size with no Measure pass reading it,
// every node takes the Resize block's slot-only update inside the delivery. A node content elsewhere
// moved then starts its next layout animation from where it's painted, as Motion's does.
//
// - PG1: a plain box above a node grows, with no trigger: one refresh (blocked, nothing seeded), and
//   the node's next move starts where it's painted. Before, it started 60 px off (#261).
// - PG2: a triggered change that grows the page runs one pass: the observer's delivery is its echo.
// - PG3: a page change and a trigger in one task run one pass, which animates the move as triggered.
// - PG4: a refresh raises every node's `layoutVersion` and runs the pass-end listeners.
// - PG5: a running animation keeps its delta through a refresh: its origin moves with its box.
// - PG6: an absolutely positioned body child, and an empty one, move nothing: no refresh as either
//   comes, resizes or goes.
// - PG7: with the body sized to the window, removing a box above a node resizes nothing still watched:
//   the child list's change refreshes.
// - PG8: under a Resize block nothing refreshes: the block's own pass reads every node, and nothing
//   animates. (This test's iframe delivers before its resize event, so it may refresh once first.)
// - PG9: a box sized to the window's height grows with it, with no trigger and no Resize block (a
//   height-only change): one refresh.
// - PG10: a box removed above a node in the same task as a trigger: one pass, which animates the move
//   as triggered (the child list's change refreshes nothing while a pass is due).
// - PG11: a node that grows the page, with no trigger, runs a pass that animates it: a node's own
//   resize wins over the page's in one delivery.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import * as Option from "effect/Option"
import { clearStages, el, endOfTask, type Engine, makeEngine, makeSink, stage, wait } from "./projection-harness.ts"
import { resizeTo, viewportSettled } from "./viewport.ts"

let width = 0
let height = 0
let bodyHeight = ""

beforeEach(() => {
  width = window.innerWidth
  height = window.innerHeight
  bodyHeight = document.body.style.height
})
afterEach(async () => {
  clearStages()
  document.body.style.height = bodyHeight
  await resizeTo(width, height)
  await viewportSettled()
})

/** Long enough for the observer's delivery and anything it runs (several real frames). */
const SETTLE_MS = 150

const spring = () => Option.some({ type: "spring" as const })

/** The spans `e` recorded since `from`. */
const since = (e: Engine, from: number) => e.spans.slice(from)
const refreshes = (e: Engine, from: number) => since(e, from).filter((s) => s.refresh === true)

/** A plain box (no node) of `height` px in an auto-height stage, so its growth grows the page. */
const plainAbove = (h: number): HTMLElement => el(stage("position:relative;width:600px"), `height:${h}px`)

/** A node's stage below it: fixed height, so only what's above moves it. */
const nodeStage = (): HTMLElement => stage("position:relative;width:600px;height:200px")

describe("the page-size refresh: a node moved by content elsewhere starts from where it's painted (#261)", () => {
  it("PG1: a plain box growing above a node refreshes once, and the node's next move starts where it's painted", async () => {
    const { sink, of } = makeSink()
    const e = makeEngine(sink)
    const spacer = plainAbove(40)
    const a = el(nodeStage(), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    spacer.style.height = "100px" // the page grows: a moves 60 px down, with no trigger
    await wait(SETTLE_MS)
    const own = since(e, before)
    expect(own, "one refresh").toHaveLength(1)
    expect(own[0]?.refresh).toBe(true)
    expect(own[0]?.blocked).toBe(true)
    expect(own[0]?.seeded).toBe(0)
    a.style.marginLeft = "100px"
    h.notify()
    await endOfTask()
    const seed = of("a").at(-1)
    expect(seed?.tx, "starts 100 px back, where it was painted").toBeCloseTo(-100, 1)
    expect(seed?.ty, "and not 60 px above it").toBeCloseTo(0, 1)
    e.dispose()
  })

  it("PG2: a triggered change that grows the page runs one pass: the delivery is its echo", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage("position:relative;width:600px"), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    a.style.height = "90px"
    h.notify()
    await wait(SETTLE_MS)
    expect(since(e, before)).toHaveLength(1)
    expect(refreshes(e, before)).toHaveLength(0)
    e.dispose()
  })

  it("PG3: a page change and a trigger in one task run one pass, which animates the move as triggered", async () => {
    const { sink, of } = makeSink()
    const e = makeEngine(sink)
    const spacer = plainAbove(40)
    const a = el(nodeStage(), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    spacer.style.height = "100px"
    h.notify()
    await wait(SETTLE_MS)
    expect(since(e, before)).toHaveLength(1)
    expect(refreshes(e, before)).toHaveLength(0)
    expect(of("a").find((w) => Math.abs(w.ty + 60) < 0.1), "its move animated from 60 px above").toBeDefined()
    e.dispose()
  })

  it("PG4: a refresh raises every node's layoutVersion and runs the pass-end listeners", async () => {
    const e = makeEngine(makeSink().sink)
    const spacer = plainAbove(40)
    const s = nodeStage()
    const ha = e.system.register({ id: "a", element: el(s, "width:50px;height:30px"), transition: spring })
    const hb = e.system.register({ id: "b", element: el(s, "width:50px;height:30px"), transition: spring })
    await wait(SETTLE_MS)
    let ends = 0
    const off = e.system.onPassEnd(() => ends++)
    const versions = [ha.layoutVersion(), hb.layoutVersion()]
    const top = Option.map(hb.layoutBox(), (b) => b.y.min)
    spacer.style.height = "100px"
    await wait(SETTLE_MS)
    expect(ends).toBe(1)
    expect([ha.layoutVersion(), hb.layoutVersion()]).toEqual([versions[0]! + 1, versions[1]! + 1])
    expect(Option.getOrThrow(Option.map(hb.layoutBox(), (b) => b.y.min)) - Option.getOrThrow(top), "b's slot is the moved one").toBeCloseTo(60, 1)
    off()
    e.dispose()
  })

  it("PG5: a running animation keeps its delta through a refresh: its origin moves with its box", async () => {
    const { sink, of } = makeSink()
    const e = makeEngine(sink)
    const spacer = plainAbove(40)
    const a = el(nodeStage(), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    a.style.marginLeft = "200px" // a sideways flight
    h.notify()
    await wait(50)
    const before = e.spans.length
    const flying = of("a").at(-1)
    expect(Math.abs(flying?.tx ?? 0), "still in flight").toBeGreaterThan(1)
    spacer.style.height = "100px"
    await wait(SETTLE_MS)
    expect(refreshes(e, before)).toHaveLength(1)
    expect(refreshes(e, before)[0]?.seeded, "nothing restarts").toBe(0)
    const writes = of("a")
    expect(writes.every((w) => Math.abs(w.ty) < 0.1), "no write moves it vertically: it moves with the content").toBe(true)
    e.dispose()
  })

  it("PG6: an absolutely positioned body child and an empty one move nothing: no refresh as they come, resize or go", async () => {
    const e = makeEngine(makeSink().sink)
    e.system.register({ id: "a", element: el(nodeStage(), "width:50px;height:30px"), transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    const floating = stage("position:absolute;left:0;top:0;width:200px;height:200px")
    await wait(SETTLE_MS)
    floating.style.height = "300px"
    await wait(SETTLE_MS)
    floating.remove()
    await wait(SETTLE_MS)
    const empty = stage("position:relative;width:600px;height:0px")
    await wait(SETTLE_MS)
    empty.remove()
    await wait(SETTLE_MS)
    expect(since(e, before)).toHaveLength(0)
    e.dispose()
  })

  it("PG7: with the body sized to the window, removing a box above a node refreshes on the child list's change", async () => {
    document.body.style.height = `${window.innerHeight}px`
    const { sink, of } = makeSink()
    const e = makeEngine(sink)
    const above = plainAbove(60).parentElement!
    const a = el(nodeStage(), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    above.remove() // a moves 60 px up; nothing still watched changes size
    await wait(SETTLE_MS)
    expect(refreshes(e, before)).toHaveLength(1)
    a.style.marginLeft = "100px"
    h.notify()
    await endOfTask()
    expect(of("a").at(-1)?.ty, "starts where it's painted").toBeCloseTo(0, 1)
    e.dispose()
  })

  it("PG8: under a Resize block nothing refreshes: the block's own pass reads every node, and nothing animates", async () => {
    const e = makeEngine(makeSink().sink)
    const spacer = plainAbove(40)
    const col = el(stage(), "position:relative;margin:0 auto;width:200px")
    e.system.register({ id: "a", element: el(col, "width:200px;height:50px"), transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    await resizeTo(width - 200, height) // every page box changes width; the block is set
    // An iframe its parent resizes (this test's) lays out, and delivers, before its own resize event:
    // that delivery refreshes, before the block is set. A window's resize event comes first.
    const early = refreshes(e, before).length
    expect(early, "at most the iframe's early delivery").toBeLessThanOrEqual(1)
    spacer.style.height = "100px" // inside the block
    await wait(100)
    expect(refreshes(e, before), "none inside the block").toHaveLength(early)
    await wait(300)
    const own = since(e, before)
    expect(own.every((s) => s.blocked === true && s.seeded === 0), `nothing animates: ${JSON.stringify(own)}`).toBe(true)
    expect(own.at(-1)?.refresh, "the block's own pass, at 250 ms").toBe(false)
    e.dispose()
  })

  it("PG9: a box sized to the window's height grows with it, with no trigger: one refresh", async () => {
    const e = makeEngine(makeSink().sink)
    stage("position:relative;width:600px;height:50vh")
    const a = el(nodeStage(), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const top = Option.map(h.layoutBox(), (b) => b.y.min)
    const before = e.spans.length
    await resizeTo(width, height - 100) // height only: no Resize block
    await wait(SETTLE_MS)
    expect(refreshes(e, before)).toHaveLength(1)
    expect(Option.getOrThrow(Option.map(h.layoutBox(), (b) => b.y.min)) - Option.getOrThrow(top)).toBeCloseTo(-50, 0)
    e.dispose()
  })

  it("PG10: removing a box above a node in the same task as a trigger runs one pass, which animates the move as triggered", async () => {
    document.body.style.height = `${window.innerHeight}px`
    const { sink, of } = makeSink()
    const e = makeEngine(sink)
    const above = plainAbove(60).parentElement!
    const a = el(nodeStage(), "width:50px;height:30px")
    const h = e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    above.remove()
    h.notify()
    await wait(SETTLE_MS)
    expect(since(e, before)).toHaveLength(1)
    expect(refreshes(e, before)).toHaveLength(0)
    expect(of("a").find((w) => Math.abs(w.ty - 60) < 0.1), "its move animated from 60 px below").toBeDefined()
    e.dispose()
  })

  it("PG11: a node that grows the page, with no trigger, runs a pass that animates it: its own resize wins over the page's", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage("position:relative;width:600px"), "width:50px;height:30px")
    e.system.register({ id: "a", element: a, transition: spring })
    await wait(SETTLE_MS)
    const before = e.spans.length
    a.style.height = "90px" // its stage, a page box, grows with it: one delivery reports both
    await wait(SETTLE_MS)
    const own = since(e, before)
    expect(own, JSON.stringify(own)).toHaveLength(1)
    expect(own[0]?.refresh).toBe(false)
    expect(own[0]?.seeded, "it animates").toBe(1)
    e.dispose()
  })
})
