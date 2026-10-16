// The projection engine's Measure pass (issue #2, ADR-0018), checked against a fake
// ProjectionSink with every Refresh frame fired by hand.
//
// Since #2 the engine owns when a layout trigger is measured: every trigger in a task
// (a node registering, the shared ResizeObserver, `notify`) queues ONE Measure pass,
// which runs in a microtask at the end of that task through `sink.flushPass(pass)`:
// the sink runs the pass and applies exactly what it wrote before returning. The
// nodes the pass seeded take their first step at the next Refresh frame, cold or warm
// (ADR-0033: no Priming step). A trigger during the pass's own flush repeats the pass,
// at most 5 rounds; a running node whose box didn't change is left alone.
//
// Deterministic: requestAnimationFrame is stubbed before the runtime builds (the
// Clock reads it when its Layer builds), so the test fires Refresh frames with chosen
// timestamps; ResizeObserver is stubbed to a no-op so no real observer delivery adds
// a pass mid-test (the solid browser tests cover that path).
import * as Clock from "@wardic/core/Clock"
import * as Projection from "@wardic/core/Projection"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { afterEach, beforeEach, vi } from "vitest"
import { DomLive } from "@wardic/dom"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"

type FrameCallback = (t: number) => void

let pendingFrames: Map<number, FrameCallback>
let nextHandle: number
let frameTime: number

beforeEach(() => {
  pendingFrames = new Map()
  nextHandle = 1
  frameTime = 1000
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCallback) => {
    const handle = nextHandle++
    pendingFrames.set(handle, cb)
    return handle
  })
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pendingFrames.delete(handle)
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.querySelectorAll("[data-mp-stage]").forEach((el) => el.remove())
})

/** Fire every pending Refresh frame at the next timestamp (one nominal interval later). */
const fireFrame = (): void => {
  frameTime += 1000 / 60
  const callbacks = [...pendingFrames.values()]
  pendingFrames.clear()
  for (const cb of callbacks) cb(frameTime)
}

/** Every microtask queued so far (and the ones they queue) has run; no timer has. */
const endOfTask = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** A later task: timers queued before it have run. */
const nextTask = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type LogEntry =
  | { readonly kind: "write"; readonly id: string; readonly translateX: number | undefined }
  | { readonly kind: "flushPass:start" }
  | { readonly kind: "flushPass:end" }

/**
 * The fake sink. `onFlush(n)` runs after the n-th flushPass's pass, where Solid
 * effects run in the real gate's batch, and may re-trigger. `scheduleMeasure` is
 * 548bbab's seam, recorded and never run, so the old engine fails on behaviour.
 */
const makeSink = (onFlush?: (n: number) => void) => {
  const log: Array<LogEntry> = []
  let flushes = 0
  const sink = {
    write: (id: string, partial: Record<string, unknown>): void => {
      const value = partial[Projection.KEY] as { delta: { x: { translate: number } } } | undefined
      log.push({ kind: "write", id, translateX: value?.delta.x.translate })
    },
    flushPass: (pass: () => void): void => {
      log.push({ kind: "flushPass:start" })
      pass()
      log.push({ kind: "flushPass:end" })
      flushes++
      onFlush?.(flushes)
    },
    scheduleMeasure: (_pass: () => void): void => {},
  }
  return { sink, log, flushes: () => flushes }
}

/** Absolutely positioned 50x50 boxes on a stage; a box moves by `style.left`. */
const makeBox = (left: number, top = 0): HTMLElement => {
  let stage = document.body.querySelector<HTMLElement>("[data-mp-stage]")
  if (stage === null) {
    stage = document.createElement("div")
    stage.dataset.mpStage = ""
    stage.style.cssText = "position:relative;width:800px;height:300px"
    document.body.append(stage)
  }
  const el = document.createElement("div")
  el.style.cssText = `position:absolute;top:${top}px;left:${left}px;width:50px;height:50px`
  stage.append(el)
  return el
}

/** Build the engine over `sink` with a DomLive runtime (rAF already stubbed). */
const makeEngine = (sink: ReturnType<typeof makeSink>["sink"]) => {
  const runtime = ManagedRuntime.make(DomLive)
  const system: ProjectionSystem.ProjectionSystem = ProjectionSystem.make(runtime, sink)
  const dispose = (): void => {
    system.dispose()
    void runtime.dispose()
  }
  return { runtime, system, dispose }
}

/** Keep the Clock ticking with a subscription of the test's own (a warm Clock). */
const keepClockWarm = (runtime: ManagedRuntime.ManagedRuntime<Clock.Clock, never>) =>
  runtime.runFork(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      yield* Stream.runForEach(clock.ticks, () => Effect.void)
    }),
  )

/** The log entries after the last `flushPass:end`. */
const afterLastFlush = (log: ReadonlyArray<LogEntry>): ReadonlyArray<LogEntry> => {
  let i = -1
  log.forEach((e, k) => {
    if (e.kind === "flushPass:end") i = k
  })
  return log.slice(i + 1)
}

/** The writes inside the last flushPass. */
const insideLastFlush = (log: ReadonlyArray<LogEntry>): ReadonlyArray<LogEntry> => {
  let start = -1
  let end = -1
  log.forEach((e, k) => {
    if (e.kind === "flushPass:start") start = k
    if (e.kind === "flushPass:end") end = k
  })
  return start < 0 || end < 0 ? [] : log.slice(start + 1, end)
}

const writesFor = (entries: ReadonlyArray<LogEntry>, id: string) =>
  entries.filter((e): e is Extract<LogEntry, { kind: "write" }> => e.kind === "write" && e.id === id)

/** Register a box as a node and let its first Measure pass run. */
const registerAt = async (system: ProjectionSystem.ProjectionSystem, id: string, left: number, top = 0) => {
  const element = makeBox(left, top)
  const handle = system.register({ id, element, transition: () => ({ type: "spring" }) })
  await endOfTask()
  return { element, handle }
}

describe("the Measure pass (ADR-0018)", () => {
  it("every trigger in a task queues one Measure pass, which runs at the end of the task", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    const a = makeBox(0)
    const b = makeBox(100)
    const c = makeBox(200)
    const ha = e.system.register({ id: "a", element: a, transition: () => ({ type: "spring" }) })
    e.system.register({ id: "b", element: b, transition: () => ({ type: "spring" }) })
    e.system.register({ id: "c", element: c, transition: () => ({ type: "spring" }) })
    ha.notify()
    ha.notify()
    e.system.notify()
    expect(s.log).toEqual([]) // nothing synchronously
    await endOfTask()
    expect(s.flushes()).toBe(1)
    e.dispose()
  })

  it("warm Clock: a moved node's seed is written inside the flush, nothing more before the next Refresh frame, which steps it", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    keepClockWarm(e.runtime)
    await endOfTask()
    fireFrame()
    fireFrame()
    const n = await registerAt(e.system, "n", 0)

    n.element.style.left = "200px"
    n.handle.notify()
    await endOfTask()
    const seed = writesFor(insideLastFlush(s.log), "n")
    expect(seed).toHaveLength(1)
    expect(seed[0]!.translateX).toBeCloseTo(-200, 3) // the origin
    expect(writesFor(afterLastFlush(s.log), "n")).toHaveLength(0) // no Priming step (ADR-0033)
    fireFrame()
    const step = writesFor(afterLastFlush(s.log), "n")
    expect(step).toHaveLength(1) // one step, not two
    expect(step[0]!.translateX!).toBeGreaterThan(-200) // it moved
    expect(step[0]!.translateX!).toBeLessThan(-150)
    e.dispose()
  })

  it("Cold start: nothing steps the node before the first Refresh frame, which takes its first step", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    const n = await registerAt(e.system, "n", 0)

    n.element.style.left = "200px"
    n.handle.notify()
    await endOfTask()
    expect(writesFor(insideLastFlush(s.log), "n")).toHaveLength(1)
    expect(writesFor(afterLastFlush(s.log), "n")).toHaveLength(0) // no Priming tick (ADR-0033)

    fireFrame() // the first Refresh frame takes the first step
    const first = writesFor(afterLastFlush(s.log), "n")
    expect(first).toHaveLength(1)
    expect(first[0]!.translateX!).toBeGreaterThan(-200)
    expect(first[0]!.translateX!).toBeLessThan(-150)
    fireFrame()
    const next = writesFor(afterLastFlush(s.log), "n")
    expect(next).toHaveLength(2)
    expect(next[1]!.translateX!).toBeGreaterThan(next[0]!.translateX!)
    e.dispose()
  })

  it("a trigger during the pass's own flush repeats the pass, at most 5 rounds; the rest runs in the next task", async () => {
    let engine: ReturnType<typeof makeEngine> | undefined
    let retriggers = 0
    const s = makeSink(() => {
      if (retriggers > 0) {
        retriggers-- // an effect in the flush re-triggers, 5 times
        engine?.system.notify()
      }
    })
    engine = makeEngine(s.sink)
    const n = await registerAt(engine.system, "n", 0)
    const before = s.flushes()

    retriggers = 5
    n.element.style.left = "200px"
    n.handle.notify()
    await endOfTask()
    expect(s.flushes() - before).toBe(5) // capped within the task
    expect(writesFor(afterLastFlush(s.log), "n")).toHaveLength(0) // nothing after the last round (ADR-0033)

    await nextTask()
    await endOfTask()
    expect(s.flushes() - before).toBe(6) // the leftover, in the next task
    await nextTask(20)
    expect(s.flushes() - before).toBe(6) // and nothing after it
    engine.dispose()
  })

  it("a single re-trigger during the flush gives two rounds, and nothing after them before the next frame", async () => {
    let engine: ReturnType<typeof makeEngine> | undefined
    let armed = false
    const s = makeSink(() => {
      if (armed) {
        armed = false
        engine?.system.notify()
      }
    })
    engine = makeEngine(s.sink)
    const n = await registerAt(engine.system, "n", 0)
    const before = s.flushes()

    armed = true
    n.element.style.left = "200px"
    n.handle.notify()
    await endOfTask()
    expect(s.flushes() - before).toBe(2)
    expect(writesFor(afterLastFlush(s.log), "n")).toHaveLength(0)
    engine.dispose()
  })

  it("leaves a running node whose box didn't change alone: no write in the flush, none after it, no restart", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    const u = await registerAt(e.system, "u", 0)
    const v = await registerAt(e.system, "v", 0, 100) // its own row: u's move can't shift it

    u.element.style.left = "200px"
    u.handle.notify()
    await endOfTask()
    for (let i = 0; i < 5; i++) fireFrame()
    const uBefore = writesFor(s.log, "u").map((w) => w.translateX!)
    const stepBefore = uBefore.at(-1)! - uBefore.at(-2)!

    v.element.style.left = "300px"
    v.handle.notify()
    await endOfTask()
    expect(writesFor(insideLastFlush(s.log), "v").length).toBeGreaterThan(0)
    expect(writesFor(insideLastFlush(s.log), "u")).toHaveLength(0) // not re-written
    expect(writesFor(afterLastFlush(s.log), "u")).toHaveLength(0) // not written after it either

    fireFrame()
    const uAfter = writesFor(s.log, "u").map((w) => w.translateX!)
    const stepAfter = uAfter.at(-1)! - uAfter.at(-2)!
    expect(stepAfter / stepBefore).toBeGreaterThan(0.6) // not restarted at zero velocity
    expect(stepAfter / stepBefore).toBeLessThan(1.6)
    e.dispose()
  })

  it("a node seeded under a running ancestor is flushed together with that ancestor's subtree; an unrelated running node is not", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    const parentEl = makeBox(0)
    parentEl.style.width = "300px"
    parentEl.style.height = "120px"
    const childEl = document.createElement("div")
    childEl.style.cssText = "position:absolute;top:10px;left:10px;width:40px;height:40px"
    parentEl.append(childEl)
    const parent = e.system.register({ id: "parent", element: parentEl, transition: () => ({ type: "spring" }) })
    const child = e.system.register({ id: "child", element: childEl, transition: () => ({ type: "spring" }) })
    const other = await registerAt(e.system, "other", 0, 200)
    await endOfTask()

    parentEl.style.left = "200px"
    parent.notify()
    other.element.style.left = "300px"
    other.handle.notify()
    await endOfTask()
    for (let i = 0; i < 3; i++) fireFrame() // parent and other are mid-flight

    childEl.style.left = "150px" // the child moves inside its running parent
    child.notify()
    await endOfTask()
    const inFlush = insideLastFlush(s.log)
    expect(writesFor(inFlush, "child").length).toBeGreaterThan(0)
    expect(writesFor(inFlush, "parent").length).toBeGreaterThan(0) // derived with it, so they paint together
    expect(writesFor(inFlush, "other")).toHaveLength(0) // unrelated: left alone
    e.dispose()
  })

  it("a node seeded below a layoutRoot carried by a running ancestor is flushed with that ancestor too", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    const outerEl = makeBox(0)
    outerEl.style.width = "400px"
    outerEl.style.height = "200px"
    const rootEl = document.createElement("div")
    rootEl.style.cssText = "position:absolute;top:0;left:0;width:300px;height:150px"
    const leafEl = document.createElement("div")
    leafEl.style.cssText = "position:absolute;top:10px;left:10px;width:40px;height:40px"
    rootEl.append(leafEl)
    outerEl.append(rootEl)
    const outer = e.system.register({ id: "outer", element: outerEl, transition: () => ({ type: "spring" }) })
    e.system.register({ id: "layout-root", element: rootEl, transition: () => ({ type: "spring" }), layoutRoot: true })
    const leaf = e.system.register({ id: "leaf", element: leafEl, transition: () => ({ type: "spring" }) })
    await endOfTask()

    outerEl.style.left = "200px"
    outer.notify()
    await endOfTask()
    for (let i = 0; i < 3; i++) fireFrame() // outer is mid-flight; the layoutRoot counter-transforms it

    leafEl.style.left = "150px"
    leaf.notify()
    await endOfTask()
    const inFlush = insideLastFlush(s.log)
    expect(writesFor(inFlush, "leaf").length).toBeGreaterThan(0)
    // The leaf is derived against the layoutRoot's delta, which follows outer's motion.
    expect(writesFor(inFlush, "layout-root").length).toBeGreaterThan(0)
    expect(writesFor(inFlush, "outer").length).toBeGreaterThan(0)
    e.dispose()
  })

  it("disposing before the end of the task runs no pass and leaves no timer behind", async () => {
    const s = makeSink()
    const e = makeEngine(s.sink)
    const el = makeBox(0)
    const h = e.system.register({ id: "n", element: el, transition: () => ({ type: "spring" }) })
    h.notify()
    e.dispose()
    await endOfTask()
    await nextTask(20)
    expect(s.flushes()).toBe(0)
    expect(s.log.filter((l) => l.kind === "write")).toHaveLength(0)
  })
})
