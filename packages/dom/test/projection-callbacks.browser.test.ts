// The app's layout animation callbacks (#191, ADR-0039), against a fake ProjectionSink with Refresh
// frames fired by hand: `onLayoutAnimationStart` / `onLayoutAnimationComplete` on a node, and
// `animateLayout(fn, { onSettled })`. They're called after a tick's flush (the Frame loop's
// `afterTick`), so inside the fired frame.
//
// - LC1: start fires at the frame where a flight takes its first step, not at the seed; two
//   starts in one task (a pass due at a Declared layout change's call, then the call's own pass)
//   are one.
// - LC2: complete fires at the frame a flight lands on its own, once, and still with a Release
//   offset running; not for a flight a restart interrupted, nor one an unmount cut off.
// - LC3: under reduced motion the flight starts landed: both fire in its first frame.
// - LC4: a layoutRoot's snap fires nothing; nor does a dragged subtree's slot-only update.
// - LC5: in a handover only the new Lead's callbacks fire, not the Follower's; LC5b: a Lead relegated
//   before its flight's first step never starts, and one relegated in flight never completes.
// - LC2b: a flight that lands under a held drag completes.
// - LC6: a callback that throws is reported, and the frame goes on.
// - LC7: `onSettled`: after a landing; after a restart cut the flight short; after an unmount; at
//   the end of its pass when it started nothing; calls in one task together; a throw reported.
// (A width change finishing a flight is RB11, in projection-resize-block.)
import { describe, expect, it } from "@effect/vitest"
import * as Easing from "@wardic/core/Easing"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, type Engine, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(() => {
  stubFrames()
})

afterEach(() => {
  unstubFrames()
  clearStages()
})

/** A 0.1 s linear tween: frame k has run k/60 s, so it lands at frame 6. */
const TWEEN: ProjectionSystem.LayoutTransition = { type: "tween", duration: 0.1, easing: Easing.linear }

/** What each node's callbacks were called with, in order: `start n0`, `complete n0`, `settled`. */
const calls: Array<string> = []

/** Register `elements` (as `n0`, `n1`…) with callbacks that log to {@link calls}, and run their first pass. */
const mount = async (
  e: Engine,
  elements: ReadonlyArray<HTMLElement>,
  extra: (i: number) => Record<string, unknown> = () => ({}),
): Promise<Array<ProjectionSystem.NodeHandle>> => {
  calls.length = 0
  const handles = elements.map((element, i) =>
    e.system.register({
      id: `n${i}`,
      element,
      transition: () => Option.some(TWEEN),
      onLayoutAnimationStart: () => Option.some(() => calls.push(`start n${i}`)),
      onLayoutAnimationComplete: () => Option.some(() => calls.push(`complete n${i}`)),
      ...extra(i),
    }),
  )
  await endOfTask()
  fireFrame()
  calls.length = 0
  return handles
}

/** A 100 × 50 box placed absolutely at `top` on `parent`. */
const absolute = (parent: HTMLElement, top: number): HTMLElement => el(parent, `position:absolute;left:0;top:${top}px;width:100px;height:50px`)

const STAGE = "position:relative;width:400px;height:600px"

/** Move `element` to `top` and notify its node: a flight is seeded at the end of the task. */
const moveTo = (element: HTMLElement, handle: ProjectionSystem.NodeHandle, top: number): void => {
  element.style.top = `${top}px`
  handle.notify()
}

describe("layout animation callbacks (#191, ADR-0039)", () => {
  it("LC1: start fires at the frame where the flight first steps, not at the seed; two starts in one task are one", async () => {
    const e = makeEngine(makeSink().sink)
    const a = absolute(stage(STAGE), 0)
    const [h] = await mount(e, [a])
    moveTo(a, h!, 100)
    await endOfTask()
    expect(calls, "seeded, not yet stepped").toEqual([])
    fireFrame()
    expect(calls).toEqual(["start n0"])
    fireFrames(10)
    calls.length = 0
    // A pass due at a call runs then (#4) and seeds a flight; the call's own pass restarts it: one start.
    moveTo(a, h!, 200)
    e.system.animateLayout(() => {
      a.style.top = "300px"
    })
    await endOfTask()
    fireFrames(10)
    expect(calls.filter((c) => c.startsWith("start"))).toEqual(["start n0"])
    e.dispose()
  })

  it("LC2: complete fires once, at the frame the flight lands, with a Release offset still running; not for an interrupted or unmounted one", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage(STAGE)
    const a = absolute(s, 0)
    const b = absolute(s, 300)
    const [ha, hb] = await mount(e, [a, b])
    moveTo(a, ha!, 100)
    await endOfTask()
    fireFrames(5)
    expect(calls).toEqual(["start n0"])
    fireFrame()
    expect(calls, "lands at frame 6").toEqual(["start n0", "complete n0"])
    fireFrames(10)
    expect(calls, "once").toEqual(["start n0", "complete n0"])

    // Interrupted at frame 2 by a restart: only the restart completes.
    calls.length = 0
    moveTo(a, ha!, 200)
    await endOfTask()
    fireFrames(2)
    moveTo(a, ha!, 0)
    await endOfTask()
    fireFrames(20)
    expect(calls).toEqual(["start n0", "start n0", "complete n0"])

    // Grabbed in flight and let go 80 px off: the flight lands while its Release offset still runs.
    calls.length = 0
    moveTo(a, ha!, 100)
    await endOfTask()
    fireFrame()
    ha!.dragStart()
    ha!.dragMove({ x: 80, y: 0 })
    ha!.dragEnd()
    fireFrames(5)
    expect(calls).toEqual(["start n0", "complete n0"])
    expect(ha!.dragOffset(), "released: no drag offset").toEqual({ x: 0, y: 0 })

    // Unmounted in flight: no complete.
    calls.length = 0
    moveTo(b, hb!, 400)
    await endOfTask()
    fireFrames(2)
    hb!.dispose()
    fireFrames(20)
    expect(calls).toEqual(["start n1"])
    e.dispose()
  })

  it("LC3: under reduced motion the flight starts landed: start and complete in its first frame", async () => {
    const e = makeEngine(makeSink().sink, { reducedMotion: () => true })
    const a = absolute(stage(STAGE), 0)
    const [h] = await mount(e, [a])
    moveTo(a, h!, 100)
    await endOfTask()
    fireFrame()
    expect(calls).toEqual(["start n0", "complete n0"])
    e.dispose()
  })

  it("LC4: a layoutRoot's snap fires nothing, nor does a dragged subtree's slot-only update", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage(STAGE)
    const root = absolute(s, 0)
    const dragged = absolute(s, 200)
    const [hr, hd] = await mount(e, [root, dragged], (i) => (i === 0 ? { layoutRoot: true } : {}))
    moveTo(root, hr!, 100)
    await endOfTask()
    fireFrames(10)
    hd!.dragStart()
    dragged.style.top = "300px"
    hd!.notify()
    await endOfTask()
    fireFrames(10)
    hd!.dragEnd()
    fireFrames(60)
    expect(calls).toEqual([])
    e.dispose()
  })

  it("LC5: in a handover only the new Lead's callbacks fire", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage(STAGE)
    const a = absolute(s, 0)
    await mount(e, [a], () => ({ layoutId: "twin" }))
    const b = absolute(s, 200)
    e.system.register({
      id: "lead",
      element: b,
      layoutId: "twin",
      transition: () => Option.some(TWEEN),
      onLayoutAnimationStart: () => Option.some(() => calls.push("start lead")),
      onLayoutAnimationComplete: () => Option.some(() => calls.push("complete lead")),
    })
    await endOfTask()
    fireFrames(20)
    expect(calls).toEqual(["start lead", "complete lead"])
    e.dispose()
  })

  it("LC5b: a Lead relegated before its flight's first step, or in flight, fires nothing more: the handover is the new Lead's", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage(STAGE)
    const register = (id: string, element: HTMLElement): ProjectionSystem.NodeHandle =>
      e.system.register({
        id,
        element,
        layoutId: "twin",
        transition: () => Option.some(TWEEN),
        onLayoutAnimationStart: () => Option.some(() => calls.push(`start ${id}`)),
        onLayoutAnimationComplete: () => Option.some(() => calls.push(`complete ${id}`)),
      })
    // In flight: started, then relegated two frames in; it never completes.
    const a = absolute(s, 0)
    const [ha] = await mount(e, [a], () => ({ layoutId: "twin" }))
    moveTo(a, ha!, 100)
    await endOfTask()
    fireFrames(2)
    register("lead", absolute(s, 300))
    await endOfTask()
    fireFrames(30)
    expect(calls).toEqual(["start n0", "start lead", "complete lead"])
    e.dispose()

    // Before its first step: moved, and relegated in the same task; it never starts.
    const e2 = makeEngine(makeSink().sink)
    const s2 = stage(STAGE)
    const c = absolute(s2, 0)
    const [hc] = await mount(e2, [c], () => ({ layoutId: "twin" }))
    moveTo(c, hc!, 100)
    e2.system.register({
      id: "lead2",
      element: absolute(s2, 300),
      layoutId: "twin",
      transition: () => Option.some(TWEEN),
      onLayoutAnimationStart: () => Option.some(() => calls.push("start lead2")),
      onLayoutAnimationComplete: () => Option.some(() => calls.push("complete lead2")),
    })
    await endOfTask()
    fireFrames(30)
    expect(calls.filter((call) => call.endsWith("n0"))).toEqual([])
    e2.dispose()
  })

  it("LC2b: a flight that lands under a held drag completes", async () => {
    const e = makeEngine(makeSink().sink)
    const a = absolute(stage(STAGE), 0)
    const [h] = await mount(e, [a])
    moveTo(a, h!, 100)
    await endOfTask()
    fireFrame()
    h!.dragStart()
    h!.dragMove({ x: 80, y: 0 })
    fireFrames(10)
    expect(calls).toEqual(["start n0", "complete n0"])
    h!.dragEnd()
    e.dispose()
  })

  it("LC6: a callback that throws is reported, and the frame goes on", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage(STAGE)
    const a = absolute(s, 0)
    const b = absolute(s, 300)
    const [ha, hb] = await mount(e, [a, b], (i) =>
      i === 0
        ? {
            onLayoutAnimationStart: () => Option.some(() => {
              throw new Error("boom")
            }),
          }
        : {},
    )
    moveTo(a, ha!, 100)
    moveTo(b, hb!, 400)
    await endOfTask()
    fireFrame()
    expect(calls, "the other node's start still fires").toEqual(["start n1"])
    fireFrames(10)
    expect(calls).toEqual(["start n1", "complete n0", "complete n1"])
    await endOfTask()
    expect(e.logs.some((l) => l.message === "wardic.projection: onLayoutAnimationStart failed")).toBe(true)
    e.dispose()
  })

  it("LC7: onSettled after a landing, a restart, an unmount, a pass that started nothing; calls in a task together; a throw reported", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage(STAGE)
    const a = absolute(s, 0)
    const b = absolute(s, 300)
    const [ha, hb] = await mount(e, [a, b])
    const settled = (label: string) => ({ onSettled: () => calls.push(`settled ${label}`) })

    // A landing: after the last complete, in that frame. Two calls in one task settle together.
    e.system.animateLayout(() => {
      a.style.top = "100px"
    }, settled("1"))
    e.system.animateLayout(() => {
      b.style.top = "400px"
    }, settled("2"))
    await endOfTask()
    fireFrames(5)
    expect(calls).toEqual(["start n0", "start n1"])
    fireFrame()
    expect(calls).toEqual(["start n0", "start n1", "complete n0", "complete n1", "settled 1", "settled 2"])

    // Cut short by a later change's restart: settled at that pass's end, before any landing.
    calls.length = 0
    e.system.animateLayout(() => {
      a.style.top = "200px"
    }, settled("restart"))
    await endOfTask()
    fireFrames(2)
    moveTo(a, ha!, 0)
    await endOfTask()
    expect(calls).toEqual(["start n0", "settled restart"])
    fireFrames(20)

    // Cut off by an unmount: settled at the end of that task.
    calls.length = 0
    e.system.animateLayout(() => {
      b.style.top = "500px"
    }, settled("unmount"))
    await endOfTask()
    fireFrames(2)
    hb!.dispose()
    expect(calls).toEqual(["start n1"])
    await endOfTask()
    expect(calls).toEqual(["start n1", "settled unmount"])

    // Nothing moved: settled at the end of its pass, with no frame.
    calls.length = 0
    e.system.animateLayout(() => {}, settled("none"))
    await endOfTask()
    expect(calls).toEqual(["settled none"])

    // A throwing onSettled is reported; the other still runs.
    calls.length = 0
    e.system.animateLayout(() => {}, {
      onSettled: () => {
        throw new Error("boom")
      },
    })
    e.system.animateLayout(() => {}, settled("after"))
    await endOfTask()
    expect(calls).toEqual(["settled after"])
    await endOfTask()
    expect(e.logs.some((l) => l.message === "wardic.projection: onSettled failed")).toBe(true)
    e.dispose()
  })
})
