import { type Clock, makeRefreshFrameClock, NOMINAL_DT, type RefreshFrameSource } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { MixedScheduler } from "effect/Scheduler"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { AtomRegistry } from "effect/unstable/reactivity"

// The Clock's Cold start contract (ADR-0017), checked against a hand-driven
// Refresh frame source. Every fiber runs on Effect's browser fallback scheduler
// (`setTimeout(0)`, since browsers have no `setImmediate`) with its dispatches
// counted, so these tests see real-browser timing: nothing in the Clock's timing
// may depend on the scheduler (decision 3).

/** A Refresh frame source the test fires by hand. `events` logs requests, cancels and deliveries in order. */
const makeFrames = () => {
  const pending = new Map<number, (t: number) => void>()
  const events: Array<string> = []
  let nextHandle = 1
  let requests = 0
  let cancels = 0
  const source: RefreshFrameSource<number> = {
    requestFrame: (callback) => {
      const handle = nextHandle++
      pending.set(handle, callback)
      requests++
      events.push("request")
      return handle
    },
    cancelFrame: (handle) => {
      pending.delete(handle)
      cancels++
      events.push("cancel")
    },
  }
  /** Fire the one outstanding Refresh frame at timestamp `t` (ms). */
  const fire = (t: number): void => {
    const entries = [...pending.entries()]
    expect(entries.length).toBe(1) // the loop keeps exactly one request outstanding
    const [handle, callback] = entries[0]!
    pending.delete(handle)
    callback(t)
  }
  return { source, pending, events, fire, requests: () => requests, cancels: () => cancels }
}

type ClockShape = Context.Service.Shape<typeof Clock>

/** Build a Clock over a fresh frame source, with every fiber on a counting `setTimeout(0)` scheduler. */
const makeHarness = async () => {
  const frames = makeFrames()
  let dispatches = 0
  const scheduler = new MixedScheduler("async", (task) => {
    dispatches++
    const timer = setTimeout(task, 0)
    return () => clearTimeout(timer)
  })
  const registry = AtomRegistry.make()
  const scope = Scope.makeUnsafe()
  const clock: ClockShape = await Effect.runPromise(
    makeRefreshFrameClock(frames.source).pipe(
      Effect.provideService(AtomRegistry.AtomRegistry, registry),
      Scope.provide(scope),
    ),
    { scheduler },
  )
  const subscribe = () => {
    const received: Array<number> = []
    const fiber = Effect.runFork(
      Stream.runForEach(clock.ticks, (dt) =>
        Effect.sync(() => {
          frames.events.push("deliver")
          received.push(dt)
        }),
      ),
      { scheduler },
    )
    return { received, fiber, close: () => Effect.runPromise(Fiber.interrupt(fiber), { scheduler }) }
  }
  return { clock, frames, registry, subscribe, dispatches: () => dispatches }
}

/** The end of the current task: one microtask checkpoint later. */
const endOfTask = (): Promise<void> => Promise.resolve()
/** A later task: every `setTimeout(0)` queued before it has run. */
const nextTimeout = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Fire a Refresh frame, then let anything the scheduler queued run. */
const fireAndSettle = async (frames: ReturnType<typeof makeFrames>, t: number): Promise<void> => {
  frames.fire(t)
  await nextTimeout()
}

describe("makeRefreshFrameClock", () => {
  it("requests no Refresh frame until something subscribes", async () => {
    const h = await makeHarness()
    await nextTimeout()
    expect(h.frames.requests()).toBe(0)
  })

  it("a Cold start delivers the Priming tick at the end of the subscribing task, with the nominal dt", async () => {
    const h = await makeHarness()
    const sub = h.subscribe()
    expect(sub.received).toEqual([]) // not synchronously inside subscribe
    await endOfTask()
    expect(sub.received).toEqual([NOMINAL_DT]) // before any Refresh frame or setTimeout(0)
    expect(h.frames.requests()).toBe(1) // then the loop asks for its first Refresh frame
    await sub.close()
  })

  it("dt stays nominal until two Refresh frame timestamps exist, then measures the interval", async () => {
    const h = await makeHarness()
    const sub = h.subscribe()
    await endOfTask()
    await fireAndSettle(h.frames, 1000) // first Refresh frame: no earlier one to measure against
    await fireAndSettle(h.frames, 1016)
    await fireAndSettle(h.frames, 1048)
    expect(sub.received).toHaveLength(4)
    expect(sub.received[0]).toBeCloseTo(NOMINAL_DT, 9) // Priming tick
    expect(sub.received[1]).toBeCloseTo(NOMINAL_DT, 9) // first Refresh frame
    expect(sub.received[2]).toBeCloseTo(0.016, 9)
    expect(sub.received[3]).toBeCloseTo(0.032, 9)
    await sub.close()
  })

  it("a Cold start after an idle gap starts over: no dt spans the gap", async () => {
    const h = await makeHarness()
    const a = h.subscribe()
    await endOfTask()
    await fireAndSettle(h.frames, 0)
    await fireAndSettle(h.frames, 1000)
    await a.close()

    // Without the acquire-time reset the next dt would be (10000 - 1000) / 1000 = 9 s.
    const b = h.subscribe()
    await endOfTask()
    await fireAndSettle(h.frames, 10000)
    await fireAndSettle(h.frames, 10016)
    expect(b.received).toHaveLength(3)
    expect(b.received[0]).toBeCloseTo(NOMINAL_DT, 9)
    expect(b.received[1]).toBeCloseTo(NOMINAL_DT, 9)
    expect(b.received[2]).toBeCloseTo(0.016, 9)
    await b.close()
  })

  it("a warm start gets no Priming tick, and nobody gets an extra tick", async () => {
    const h = await makeHarness()
    const a = h.subscribe()
    await endOfTask()
    await fireAndSettle(h.frames, 1000)
    expect(a.received).toHaveLength(2) // Priming tick + first Refresh frame

    const b = h.subscribe() // joins the running loop
    await endOfTask()
    await nextTimeout()
    expect(b.received).toEqual([])
    expect(a.received).toHaveLength(2)

    await fireAndSettle(h.frames, 1016)
    expect(a.received).toHaveLength(3)
    expect(a.received[2]).toBeCloseTo(0.016, 9)
    expect(b.received).toHaveLength(1)
    expect(b.received[0]).toBeCloseTo(0.016, 9)
    await a.close()
    await b.close()
  })

  it("never goes through the Effect scheduler: each Refresh frame is re-requested inside its callback, after delivery", async () => {
    const h = await makeHarness()
    const before = h.dispatches()
    const sub = h.subscribe()
    await endOfTask()
    for (const t of [1000, 1016, 1033]) {
      h.frames.events.length = 0
      h.frames.fire(t)
      // Synchronously, still inside the Refresh frame callback's call stack:
      expect(h.frames.events).toEqual(["deliver", "request"])
      expect(h.frames.pending.size).toBe(1)
    }
    await nextTimeout()
    expect(h.dispatches() - before).toBe(0)
    expect(sub.received).toHaveLength(4)
    await sub.close()
  })

  it("the last unsubscribe cancels the pending Refresh frame", async () => {
    const h = await makeHarness()
    const a = h.subscribe()
    const b = h.subscribe()
    await endOfTask()
    await fireAndSettle(h.frames, 1000)
    expect(h.frames.requests()).toBe(2) // ONE shared loop: first Refresh frame + its re-request

    await a.close()
    expect(h.frames.cancels()).toBe(0)
    expect(h.frames.pending.size).toBe(1)

    await b.close()
    expect(h.frames.cancels()).toBe(1)
    expect(h.frames.pending.size).toBe(0)
    await nextTimeout()
    expect(h.frames.requests()).toBe(2) // nothing requested after teardown
  })

  it("unsubscribing before the Priming tick delivers nothing and leaves no Refresh frame pending", async () => {
    const h = await makeHarness()
    const sub = h.subscribe()
    sub.fiber.interruptUnsafe() // same synchronous block: the Priming microtask hasn't run
    await endOfTask()
    await nextTimeout()
    expect(sub.received).toEqual([])
    expect(h.frames.pending.size).toBe(0)
  })

  it("writes the time and dt Atoms: the Priming tick sets dt only, Refresh frames set both", async () => {
    const h = await makeHarness()
    const sub = h.subscribe()
    expect(h.registry.get(h.clock.time)).toBe(0)
    expect(h.registry.get(h.clock.dt)).toBe(0)

    await endOfTask()
    expect(h.registry.get(h.clock.dt)).toBeCloseTo(NOMINAL_DT, 9)
    expect(h.registry.get(h.clock.time)).toBe(0) // the Priming tick has no Refresh frame timestamp

    await fireAndSettle(h.frames, 1000)
    await fireAndSettle(h.frames, 1100)
    expect(h.registry.get(h.clock.time)).toBe(1100)
    expect(h.registry.get(h.clock.dt)).toBeCloseTo(0.1, 9)
    await sub.close()
  })
})
