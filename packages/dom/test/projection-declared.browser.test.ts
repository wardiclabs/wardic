// A **Declared layout change** (#4, ADR-0038): `ProjectionSystem.animateLayout(fn)`, checked
// against a fake ProjectionSink with Refresh frames fired by hand (ResizeObserver is a no-op, so a
// Measure pass comes only from `notify` or a call). A seeded node's first write after a pass is its
// progress-0 frame, so its translate is where it animates from, less where it lands.
//
// - DL1: a declared change animates from where the node is at the call, though an untriggered
//   change had left its last Measurement stale; a plain trigger animates the stale move too.
// - DL2: Motion's `parallel-calls-intersecting` (dev/html/public/animate-layout at `16c6122`): two
//   calls in one task, where A's change pushes B's element. B animates from where it was before
//   either change, and at 50% of a linear tween both read Motion's boxes.
// - DL3: a Measure pass already due runs at the call, so what triggered it animates as it would
//   have, and the end-of-task pass animates the call's change: two passes, no more. A second call
//   in the task shares the Measurements.
// - DL4: the callback's result comes back, its error throws to the caller with the pass still
//   run, and a promise from it logs a warning.
// - DL5: a running animation the callback moves restarts from where it paints; one it doesn't
//   move carries on, not re-seeded.
// - DL6: the call's Measurements raise no `layoutVersion` and end no pass (a Reorder group waits
//   on the layout after its change); the end-of-task pass does both.
// - DL7: a call from inside a pass's own flush animates from that pass's reads, in a second round.
// - DL8: a call in a later task takes its own Measurements.
// (The Resize block winning is RB10, in projection-resize-block.)
import { describe, expect, it } from "@effect/vitest"
import * as Easing from "@wardic/core/Easing"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { onPassEnd } from "../src/internal/projection.ts"
import { clearStages, el, endOfTask, type Engine, fireFrame, fireFrames, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(() => {
  stubFrames()
})

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>

const SPRING: ProjectionSystem.LayoutTransition = { type: "spring" }
const LINEAR: ProjectionSystem.LayoutTransition = { type: "tween", duration: 0.2, ease: Easing.linear }

/** Register `elements` (as `n0`, `n1`…) on `transition` and run their first pass. */
const mount = async (e: Engine, elements: ReadonlyArray<HTMLElement>, transition: ProjectionSystem.LayoutTransition = SPRING): Promise<Array<ProjectionSystem.NodeHandle>> => {
  const handles = elements.map((element, i) => e.system.register({ id: `n${i}`, element, transition: () => Option.some(transition) }))
  await endOfTask()
  fireFrame()
  return handles
}

/** `id`'s first write from index `from` on: a node a pass seeded writes its progress-0 frame first. */
const seedOf = (sk: Sink, id: string, from: number) => sk.writes.slice(from).find((w) => w.id === id)

/** A 100 × 50 box placed absolutely at `top` on `parent`. */
const absolute = (parent: HTMLElement, top: number): HTMLElement =>
  el(parent, `position:absolute;left:0;top:${top}px;width:100px;height:50px`)

describe("a Declared layout change (#4, ADR-0038)", () => {
  it("DL1: it animates from where the node is at the call, though an untriggered change left its Measurement stale", async () => {
    // Undeclared, the pass that follows animates the untriggered move too: the gap #4 closes.
    const run = async (declared: boolean): Promise<number | undefined> => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const s = stage("position:relative;width:400px;height:600px")
      const panel = el(s, "width:100px;height:50px") // a plain element, no node
      const node = el(s, "width:100px;height:50px")
      const [h] = await mount(e, [node])
      panel.style.height = "100px" // no trigger: the node moves 50 px down unmeasured
      const change = (): void => {
        node.style.marginTop = "30px"
      }
      if (declared) e.system.animateLayout(change)
      else {
        change()
        h!.notify()
      }
      const at = sk.writes.length
      await endOfTask()
      const ty = seedOf(sk, "n0", at)?.ty
      e.dispose()
      return ty
    }
    expect(await run(true), "from where it was at the call: 30 px above").toBeCloseTo(-30, 6)
    expect(await run(false), "a plain trigger: from its stale Measurement, 80 px above").toBeCloseTo(-80, 6)
  })

  it("DL2: Motion's parallel-calls-intersecting: B animates from before A's change pushed it, and at 50% both read Motion's boxes", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:400px;height:600px")
    const grow = el(s, "width:100px;height:100px")
    const child = el(s, "width:100px;height:100px")
    await mount(e, [grow, child], LINEAR)
    // Same task: A's change grows #grow, which pushes B's #child down; B shifts it right.
    e.system.animateLayout(() => {
      grow.style.height = "200px"
    })
    e.system.animateLayout(() => {
      child.style.marginLeft = "100px"
    })
    const at = sk.writes.length
    await endOfTask()
    // #child: from (0, 100) to (100, 200), not from (0, 200) where A's change put it.
    const childSeed = seedOf(sk, "n1", at)
    expect(childSeed?.tx).toBeCloseTo(-100, 6)
    expect(childSeed?.ty).toBeCloseTo(-100, 6)
    // #grow: from 100 px tall to 200, its top where it was.
    expect(seedOf(sk, "n0", at)?.sy).toBeCloseTo(0.5, 6)
    // Frame k has run k/60 s: 0.1 s of the 0.2 s tween is frame 6, half way.
    fireFrames(6)
    const g = sk.of("n0").at(-1)!
    const c = sk.of("n1").at(-1)!
    // A box's painted top and bottom about its centre: its layout box scaled, then translated.
    const growTop = 100 + (0 - 100) * g.sy + g.ty
    const growBottom = 100 + (200 - 100) * g.sy + g.ty
    expect([growTop, growBottom], "#grow at 50%: Motion's top 0, bottom 150").toEqual([expect.closeTo(0, 4), expect.closeTo(150, 4)])
    // #child's layout box is (100, 200)–(200, 300) on the stage.
    expect([100 + c.tx, 200 + c.ty], "#child at 50%: Motion's left 50, top 150").toEqual([expect.closeTo(50, 4), expect.closeTo(150, 4)])
    e.dispose()
  })

  it("DL3: a pass already due runs at the call, so what triggered it animates; the end-of-task pass animates the call's change", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:400px;height:600px")
    const a = absolute(s, 0)
    const b = absolute(s, 200)
    const [ha] = await mount(e, [a, b])
    const passes = e.spans.length
    a.style.top = "50px"
    ha!.notify() // due at the end of the task
    const from = sk.writes.length
    e.system.animateLayout(() => {
      b.style.top = "300px"
    })
    expect(e.spans.length - passes, "the pass that was due ran at the call").toBe(1)
    expect(e.spans.at(-1)?.seeded, "and animated what triggered it").toBe(1)
    expect(seedOf(sk, "n0", from)?.ty).toBeCloseTo(-50, 6)
    // A second call in the task shares those Measurements: it doesn't read B where the first call put it.
    e.system.animateLayout(() => {})
    const at = sk.writes.length
    await endOfTask()
    expect(e.spans.length - passes, "one more pass, at the end of the task").toBe(2)
    expect(seedOf(sk, "n1", at)?.ty).toBeCloseTo(-100, 6)
    e.dispose()
  })

  it("DL4: the callback's result comes back, its error throws to the caller with the pass still run, and a promise warns", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:400px;height:600px")
    const b = absolute(s, 0)
    await mount(e, [b])
    expect(e.system.animateLayout(() => 42)).toBe(42)
    await endOfTask()
    const at = sk.writes.length
    expect(() =>
      e.system.animateLayout(() => {
        b.style.top = "100px"
        throw new Error("boom")
      }),
    ).toThrow("boom")
    await endOfTask()
    expect(seedOf(sk, "n0", at)?.ty, "what it changed before throwing animates").toBeCloseTo(-100, 6)
    const warning = "wardic.projection: animateLayout's callback returned a promise; only its synchronous part animates"
    expect(e.logs.filter((l) => l.message === warning)).toHaveLength(0)
    void e.system.animateLayout(async () => {})
    await endOfTask()
    expect(e.logs.filter((l) => l.message === warning)).toHaveLength(1)
    e.dispose()
  })

  it("DL5: a running animation the callback moves restarts from where it paints; one it doesn't move carries on", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:400px;height:600px")
    const a = absolute(s, 0)
    const c = absolute(s, 300)
    const [ha, hc] = await mount(e, [a, c])
    a.style.top = "100px"
    c.style.top = "400px"
    ha!.notify()
    hc!.notify()
    await endOfTask()
    fireFrames(4)
    const paintedA = 100 + sk.of("n0").at(-1)!.ty
    const cBefore = sk.of("n1").at(-1)!.ty
    const passes = e.spans.length
    e.system.animateLayout(() => {
      a.style.top = "200px"
    })
    const at = sk.writes.length
    await endOfTask()
    expect(e.spans.at(-1)?.seeded, "only the node it moved").toBe(1)
    expect(e.spans.length - passes).toBe(1)
    expect(200 + seedOf(sk, "n0", at)!.ty, "from where it painted").toBeCloseTo(paintedA, 6)
    fireFrame()
    const cNext = sk.of("n1").at(-1)!.ty
    expect(Math.abs(cNext), "the other carries on toward its slot").toBeLessThan(Math.abs(cBefore))
    e.dispose()
  })

  it("DL6: the call's Measurements raise no layoutVersion and end no pass; the end-of-task pass does both", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage("position:relative;width:400px;height:600px")
    const b = absolute(s, 0)
    const [h] = await mount(e, [b])
    let ends = 0
    const off = onPassEnd(e.system, () => ends++)
    const version = h!.layoutVersion()
    e.system.animateLayout(() => {
      b.style.top = "100px"
    })
    expect(h!.layoutVersion(), "the layout from before the change isn't a new one").toBe(version)
    expect(ends).toBe(0)
    await endOfTask()
    expect(h!.layoutVersion()).toBe(version + 1)
    expect(ends).toBe(1)
    off()
    e.dispose()
  })

  it("DL7: a call from inside a pass's own flush animates from that pass's reads, in a second round", async () => {
    const sk = makeSink()
    let hook: (() => void) | undefined
    const sink = {
      ...sk.sink,
      flushPass: (pass: () => void): void => {
        pass()
        const h = hook
        hook = undefined
        h?.()
      },
    }
    const e = makeEngine(sink)
    const s = stage("position:relative;width:400px;height:600px")
    const a = absolute(s, 0)
    const b = absolute(s, 200)
    const [ha] = await mount(e, [a, b])
    // An effect in the flush, as an app's could be, declares a change.
    hook = () =>
      e.system.animateLayout(() => {
        b.style.top = "300px"
      })
    a.style.top = "50px"
    ha!.notify()
    const at = sk.writes.length
    await endOfTask()
    expect(e.spans.at(-1)?.rounds).toBe(2)
    expect(e.spans.at(-1)?.seeded).toBe(2)
    expect(seedOf(sk, "n1", at)?.ty).toBeCloseTo(-100, 6)
    e.dispose()
  })

  it("DL8: a call in a later task takes its own Measurements", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const s = stage("position:relative;width:400px;height:600px")
    const panel = el(s, "width:100px;height:50px")
    const node = el(s, "width:100px;height:50px")
    await mount(e, [node])
    e.system.animateLayout(() => {
      node.style.marginTop = "10px"
    })
    await endOfTask()
    fireFrames(120)
    panel.style.height = "100px" // untriggered, after the first call's pass
    e.system.animateLayout(() => {
      node.style.marginTop = "40px"
    })
    const at = sk.writes.length
    await endOfTask()
    expect(seedOf(sk, "n0", at)?.ty, "from the second call's Measurement: 30 px above").toBeCloseTo(-30, 6)
    e.dispose()
  })
})
