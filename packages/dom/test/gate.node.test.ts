// The flush gate (ADR-0006), framework-free in dom (ADR-0031): its logic in the node tier, on a
// hand-driven Refresh frame source provided as the Environment's member (`gate-harness.ts`) and a
// `batch` handed in as a binding would. What needs a real element (commit sinks) is in
// `gate.browser.test.ts`, and what needs Solid's `batch` in solid's own gate tests.
import * as Clock from "@wardic/core/Clock"
import * as Projection from "@wardic/core/Projection"
import type * as Renderer from "@wardic/core/Renderer"
import { makeFlushGate, RendererDomLive } from "@wardic/dom"
import { TestClock, TestLive, TestRenderer } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { beforeEach, describe, expect, it } from "vitest"
import { fireFrame, frames, NO_BATCH, resetFrames, withFrames } from "./gate-harness.ts"

beforeEach(resetFrames)

describe("makeFlushGate", () => {
  it("signal sink receives the projected patch after one fired frame (1-frame latency)", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })

      gate.write("a", { x: 1 })
      // Before the frame: the signal is unchanged.
      expect(received).toBeUndefined()
      expect(frames.request).toHaveBeenCalledTimes(1)

      fireFrame()
      // TestRenderer.project is identity, so the patch mirrors the value-map.
      expect(received).toEqual({ x: 1 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("one batch per frame applies multiple registered elements together", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let applied = 0
      const seen: Array<Renderer.Patch> = []
      gate.register("a", {
        kind: "signal",
        set: (p) => {
          applied++
          seen.push(p)
        },
      })
      gate.register("b", {
        kind: "signal",
        set: (p) => {
          applied++
          seen.push(p)
        },
      })

      gate.write("a", { x: 1 })
      gate.write("b", { y: 2 })
      // Two writes, but the gate schedules a single frame.
      expect(frames.request).toHaveBeenCalledTimes(1)
      expect(applied).toBe(0)

      fireFrame()
      // Both elements applied in the single fired frame.
      expect(applied).toBe(2)
      expect(seen).toContainEqual({ x: 1 })
      expect(seen).toContainEqual({ y: 2 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("applies through the binding's batch: once per frame flush and once per pass, every apply inside it", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const events: Array<string> = []
      const gate = makeFlushGate(runtime, {
        batch: (apply) => {
          events.push("batch")
          apply()
          events.push("end")
        },
      })
      gate.register("a", { kind: "signal", set: () => void events.push("a") })
      gate.register("b", { kind: "signal", set: () => void events.push("b") })

      gate.write("a", { x: 1 })
      gate.write("b", { y: 2 })
      expect(events).toEqual([]) // a write applies nothing
      fireFrame()
      expect(events).toEqual(["batch", "a", "b", "end"])

      events.length = 0
      gate.flushPass(() => gate.write("a", { x: 3 }))
      expect(events).toEqual(["batch", "a", "end"])

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("same-key writes within a frame coalesce (last wins); different keys merge", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })

      gate.write("a", { x: 1 })
      gate.write("a", { x: 2 }) // same key — last value wins
      gate.write("a", { y: 9 }) // different key — merges in
      // Still one frame for all three writes.
      expect(frames.request).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(received).toEqual({ x: 2, y: 9 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("gated frames: a flush with nothing newly written requests no new frame; a fresh write requests one", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })

      gate.write("a", { x: 1 })
      expect(frames.request).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(received).toEqual({ x: 1 })
      // GATED: flush does NOT auto-reschedule — idle accumulator => no new frame.
      expect(frames.request).toHaveBeenCalledTimes(1)
      expect(frames.pending.size).toBe(0)

      // A fresh write requests one.
      gate.write("a", { x: 5 })
      expect(frames.request).toHaveBeenCalledTimes(2)
      fireFrame()
      expect(received).toEqual({ x: 5 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("unregister removes the element and a subsequent write is a no-op", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      const unregister = gate.register("a", { kind: "signal", set: (p) => (received = p) })

      unregister()
      gate.write("a", { x: 1 })
      // No-op: nothing registered under "a", so no frame is requested.
      expect(frames.request).not.toHaveBeenCalled()

      fireFrame()
      expect(received).toBeUndefined()

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("dispose cancels a pending frame", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      gate.register("a", { kind: "signal", set: () => {} })
      gate.write("a", { x: 1 })
      expect(frames.request).toHaveBeenCalledTimes(1)
      expect(frames.pending.size).toBe(1)

      gate.dispose()
      expect(frames.cancel).toHaveBeenCalledTimes(1)
      expect(frames.pending.size).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })

  it("on pushable frames, an advance flushes what the last advance's tick wrote, then ticks: the web's order", async () => {
    // One `advance` is one Refresh frame: the frames requested so far (the gate's flush), then
    // the Clock's tick (ADR-0031, decision 6). A tick's write paints in the next frame.
    const clock = Effect.runSync(TestClock.pushable())
    const runtime = ManagedRuntime.make(Layer.merge(TestRenderer.layer, clock.layer))
    const events: Array<string> = []
    const gate = makeFlushGate(runtime, NO_BATCH)
    gate.register("a", { kind: "signal", set: (p) => void events.push(`flush ${String(p.x)}`) })
    const { ticks } = runtime.runSync(Effect.service(Clock.Clock))
    let n = 0
    const fiber = runtime.runFork(
      Stream.runForEach(ticks, () =>
        Effect.sync(() => {
          n++
          events.push(`tick ${n}`)
          gate.write("a", { x: n })
        })),
    )
    await runtime.runPromise(clock.advance())
    expect(events).toEqual(["tick 1"])
    await runtime.runPromise(clock.advance())
    await runtime.runPromise(clock.advance())
    expect(events).toEqual(["tick 1", "flush 1", "tick 2", "flush 2", "tick 3"])
    await runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await runtime.dispose()
  })
})

describe("makeFlushGate — flushPass (the Measure pass flush; ADR-0018, ADR-0006 amendment)", () => {
  it("runs the pass synchronously and applies exactly what it wrote before returning, with no frame fired", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const order: Array<string> = []
      let received: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => ((received = p), order.push("apply")) })

      gate.flushPass(() => {
        order.push("pass")
        gate.write("a", { x: 1 }) // a FLIP seed written by the Measure pass
      })
      expect(order).toEqual(["pass", "apply"])
      expect(received).toEqual({ x: 1 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("leaves an entry the pass did not write for the next frame, even if it was already dirty", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let a: Renderer.Patch | undefined
      let b: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (a = p) })
      gate.register("b", { kind: "signal", set: (p) => (b = p) })

      gate.write("b", { y: 2 }) // e.g. another animation's value from this frame's Clock tick
      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(a).toEqual({ x: 1 })
      expect(b).toBeUndefined() // keeps ADR-0006's one-frame latency

      fireFrame()
      expect(b).toEqual({ y: 2 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("the next frame does not re-apply an entry the pass flushed unless it was written again", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let applied = 0
      gate.register("a", { kind: "signal", set: () => applied++ })

      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(applied).toBe(1)
      fireFrame()
      expect(applied).toBe(1)

      gate.write("a", { x: 2 })
      fireFrame()
      expect(applied).toBe(2)

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("has no measure read-queue any more", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      expect("scheduleMeasure" in gate).toBe(false)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("after dispose, a pass applies nothing and requests no frame", () => {
    const runtime = ManagedRuntime.make(withFrames(TestLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      let applied = 0
      gate.register("a", { kind: "signal", set: () => applied++ })
      gate.dispose()

      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(applied).toBe(0)
      expect(frames.pending.size).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })
})

// The raise's reset (ADR-0016, *Amendment (Reorder)*): the engine carries a dragged
// node's raise inside `@projection`, and the renderer emits `z-index` only while it's
// there. A signal sink's next patch simply lacks the key; a commit sink removes a key its
// previous patch had and this one doesn't (`gate.browser.test.ts`, GK1–GK2). DOM's `project`
// builds anywhere (ADR-0021, decision 7), so these run on `RendererDomLive`.
describe("makeFlushGate — a key that drops out of a patch", () => {
  const IDENTITY: Projection.Delta = {
    x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
    y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  }
  const raised = { [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 }, raise: 1 } }
  const lowered = { [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 } } }

  it("GK3: a signal sink's patch carries z-index while raised and lacks it after", () => {
    const runtime = ManagedRuntime.make(withFrames(RendererDomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const patches: Array<Renderer.Patch> = []
      gate.register("a", { kind: "signal", set: (p) => patches.push(p) })
      gate.write("a", raised)
      fireFrame()
      gate.write("a", lowered)
      fireFrame()
      expect(patches[0]?.["z-index"]).toBe(1)
      expect(patches[1] !== undefined && "z-index" in patches[1]).toBe(false)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

describe("makeFlushGate — release (#47, ADR-0022): a key handed back to the element's own style", () => {
  it("GR1: a signal sink's next patch lacks a released key and keeps the rest", () => {
    const runtime = ManagedRuntime.make(withFrames(RendererDomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const patches: Array<Renderer.Patch> = []
      gate.register("a", { kind: "signal", set: (p) => patches.push(p) })
      gate.write("a", { opacity: 0.5, scale: 1.2 })
      fireFrame()
      gate.release("a", ["opacity"])
      fireFrame()
      expect(patches[1]).toEqual({ transform: "scale(1.2)" })
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GR4: releasing a key the entry doesn't hold, or an unknown id, requests nothing", () => {
    const runtime = ManagedRuntime.make(withFrames(RendererDomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      gate.register("a", { kind: "signal", set: () => {} })
      gate.write("a", { opacity: 0.5 })
      fireFrame()
      const calls = frames.request.mock.calls.length
      gate.release("a", ["scale"])
      gate.release("nobody", ["opacity"])
      expect(frames.request.mock.calls.length).toBe(calls)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})
