// A window resize blocks the next Measure pass (ADR-0018, *Amendment (#39)*), checked
// against a fake ProjectionSink with Refresh frames fired by hand and real viewport
// changes (`page.viewport`, which resizes the test iframe and fires `resize`).
//
// A change of `window.innerWidth` finishes running layout animations and blocks the next
// pass within 250 ms: every node gets a slot-only update (fresh boxes, nothing seeded),
// and the pass clears the block. If none runs, the engine runs one itself at 250 ms; a
// drag that starts while boxes are stale runs it first. A height-only change does
// nothing, and a Declared layout change in the block animates nothing (#4, RB10). The flights a
// width change finishes fire no complete, and settle a Declared layout change waiting on them (#191, RB11).
// A burst of width changes ends in one blocked pass, however long it lasts: each change restarts the
// block's wait (RB8, RB12).
// The width comes from the Environment's `Probe.viewport`, written inside the resize event, so the
// block is set in the event's own dispatch, before any scheduler hop (#45, RB13).
// Before, nothing re-measured on a resize, so the next pass animated every node from
// its box before the resize (#39).
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, type Engine, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames, wait } from "./projection-harness.ts"
import { resizeTo, viewportSettled } from "./viewport.ts"
import * as Option from "effect/Option"
import * as Scheduler from "effect/Scheduler"

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
  await resizeTo(width, height)
  await viewportSettled() // nothing in flight into the next test
})

/** Narrow the window by `by` px; the engine has seen the resize when this returns. */
const narrow = (by = 200): Promise<void> => resizeTo(width - by, height)

/** A centred 200 px column of `n` 50 px items (10 px apart): a width change moves it sideways. */
const centredColumn = (n: number): Array<HTMLElement> => {
  const col = el(stage(), "position:relative;margin:0 auto;width:200px")
  return Array.from({ length: n }, () => el(col, "width:200px;height:50px;margin-bottom:10px"))
}

const mount = async (e: Engine, els: ReadonlyArray<HTMLElement>, extra: { raiseWhileDragged?: boolean } = {}) => {
  const handles: Array<ProjectionSystem.NodeHandle> = els.map((element, i) =>
    e.system.register({ id: `n${i}`, element, transition: () => Option.some({ type: "spring" }), ...extra }),
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
    await resizeTo(width, height - 150)
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
    // Each step waits for the last command's reply: one slower than 250 ms would split the burst.
    for (let k = 0; k < 5; k++) await resizeTo(width - 40 * (k + 1), height)
    await wait(350)
    const own = e.spans.slice(before)
    expect(own).toHaveLength(1)
    expect(own[0]?.blocked).toBe(true)
    e.dispose()
  })

  it("RB12: a burst longer than the block still ends in one blocked pass: each change restarts the wait (#69)", async () => {
    const e = makeEngine(makeSink().sink)
    await mount(e, centredColumn(5))
    const before = e.spans.length
    // Five changes about 100 ms apart, so the burst outlasts 250 ms while no gap reaches it.
    const at: Array<number> = []
    for (let k = 0; k < 5; k++) {
      await resizeTo(width - 40 * (k + 1), height)
      at.push(performance.now())
      if (k < 4) await wait(100)
    }
    const gaps = at.slice(1).map((t, i) => t - at[i]!)
    expect(Math.max(...gaps), "no gap reaches the block's 250 ms (a slow step would split the burst)").toBeLessThan(250)
    expect(at[4]! - at[0]!, "the burst outlasts one block").toBeGreaterThan(250)
    await wait(350)
    const own = e.spans.slice(before)
    expect(own, "one pass, 250 ms after the last change").toHaveLength(1)
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

  it("RB10: a Declared layout change in the block runs its callback and animates nothing, a pass already due or not (#4: the Resize block wins)", async () => {
    const e = makeEngine(makeSink().sink)
    const els = centredColumn(5)
    const handles = await mount(e, els)
    await narrow()
    // A pass due in the block doesn't run at the call: it would take the block, and leave the call's pass free to animate.
    handles[0]!.notify()
    const before = e.spans.length
    const result = e.system.animateLayout(() => {
      els[1]!.parentElement!.insertBefore(els[2]!, els[1]!)
      return "ran"
    })
    expect(result).toBe("ran")
    expect(e.spans.length, "no pass ran at the call").toBe(before)
    await endOfTask()
    expect(e.spans.length - before, "one pass, at the end of the task").toBe(1)
    expect(e.spans.at(-1)?.blocked).toBe(true)
    expect(e.spans.at(-1)?.seeded).toBe(0)
    e.dispose()
  })

  it("RB11: a width change that finishes a flight fires no complete, and settles a Declared layout change waiting on it (#191)", async () => {
    const e = makeEngine(makeSink().sink)
    const els = centredColumn(3)
    const calls: Array<string> = []
    els.forEach((element, i) =>
      e.system.register({
        id: `c${i}`,
        element,
        transition: () => Option.some({ type: "spring" }),
        onLayoutAnimationStart: () => Option.some(() => calls.push(`start c${i}`)),
        onLayoutAnimationComplete: () => Option.some(() => calls.push(`complete c${i}`)),
      }),
    )
    await endOfTask()
    fireFrame()
    e.system.animateLayout(
      () => {
        els[0]!.style.marginTop = "40px"
      },
      { onSettled: () => calls.push("settled") },
    )
    await endOfTask()
    fireFrames(2)
    expect(calls).toEqual(["start c0", "start c1", "start c2"])
    await narrow()
    expect(calls, "finished early: no complete, and settled").toEqual(["start c0", "start c1", "start c2", "settled"])
    fireFrames(30)
    expect(calls.filter((c) => c.startsWith("complete"))).toEqual([])
    e.dispose()
  })

  it("RB13: the block is set inside the resize event's own dispatch, before any scheduler hop (#45)", async () => {
    // A browser's setTimeout(0) scheduler: a hop is a task after the event, not the microtask the
    // test tier's polyfill makes it, which could land between two listeners of one dispatch.
    const scheduler = new Scheduler.MixedScheduler("async", (task) => {
      const timer = setTimeout(task, 0)
      return () => clearTimeout(timer)
    })
    const e = makeEngine(makeSink().sink, undefined, scheduler)
    const els = centredColumn(5)
    const handles = await mount(e, els)
    // RB10's rule, in the event: with the block set, a pass due isn't run at a Declared layout
    // change's call. Set a scheduler hop later, it would run there, unblocked.
    let atCall = -1
    const inTheEvent = (): void => {
      handles[0]!.notify()
      const before = e.spans.length
      e.system.animateLayout(() => {
        els[1]!.parentElement!.insertBefore(els[2]!, els[1]!)
      })
      atCall = e.spans.length - before
    }
    window.addEventListener("resize", inTheEvent)
    try {
      await narrow()
    } finally {
      window.removeEventListener("resize", inTheEvent)
    }
    expect(atCall, "no pass at the call: the block was already set in this dispatch").toBe(0)
    await endOfTask()
    expect(e.spans.at(-1)?.blocked).toBe(true)
    expect(e.spans.at(-1)?.seeded).toBe(0)
    e.dispose()
  })
})
