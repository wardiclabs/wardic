import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import type { Patch } from "@wardic/core"
import { DomLive } from "@wardic/dom"
import { TestLive } from "@wardic/test"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { createRoot } from "solid-js"
import { makeFlushGate } from "../src/gate.ts"

/**
 * Hand-driven requestAnimationFrame (mirrors packages/dom/test/clock.test.ts):
 * capture each scheduled callback so the test fires frames deterministically
 * and asserts scheduling via rAF/caf call counts. The gate keeps at most one
 * frame outstanding (gated), so `fireFrame` runs the single pending callback.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number
let rafSpy: ReturnType<typeof vi.fn>
let cafSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  pending = new Map()
  nextId = 1
  rafSpy = vi.fn((cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  cafSpy = vi.fn((id: number) => {
    pending.delete(id)
  })
  vi.stubGlobal("requestAnimationFrame", rafSpy)
  vi.stubGlobal("cancelAnimationFrame", cafSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Fire the single outstanding rAF callback. */
const fireFrame = (t = 0): void => {
  const entries = [...pending.entries()]
  const last = entries[entries.length - 1]
  if (last === undefined) return
  pending.delete(last[0])
  last[1](t)
}

describe("makeFlushGate", () => {
  it("signal sink receives the projected patch after one fired frame (1-frame latency)", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let received: Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })

      gate.write("a", { x: 1 })
      // Before the frame: the signal is unchanged.
      expect(received).toBeUndefined()
      expect(rafSpy).toHaveBeenCalledTimes(1)

      fireFrame()
      // TestRenderer.project is identity, so the patch mirrors the value-map.
      expect(received).toEqual({ x: 1 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("commit sink writes the projected patch onto a happy-dom element's style", () => {
    // DomLive so project groups transforms / applies units and commit writes style.
    const runtime = ManagedRuntime.make(DomLive)
    try {
      const gate = makeFlushGate(runtime)
      const el = document.createElement("div")
      gate.register("el", { kind: "commit", target: el })

      gate.write("el", { x: 10, opacity: 0.5 })
      // Before the frame: style untouched.
      expect(el.style.transform).toBe("")

      fireFrame()
      expect(el.style.transform).toBe("translateX(10px)")
      expect(el.style.opacity).toBe("0.5")

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("one batch per frame applies multiple registered elements together", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let applied = 0
      const seen: Array<Patch> = []
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
      expect(rafSpy).toHaveBeenCalledTimes(1)
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

  it("same-key writes within a frame coalesce (last wins); different keys merge", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let received: Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })

      gate.write("a", { x: 1 })
      gate.write("a", { x: 2 }) // same key — last value wins
      gate.write("a", { y: 9 }) // different key — merges in
      // Still one frame for all three writes.
      expect(rafSpy).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(received).toEqual({ x: 2, y: 9 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("gated rAF: a flush with nothing newly written schedules no new frame; a fresh write reschedules", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let received: Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })

      gate.write("a", { x: 1 })
      expect(rafSpy).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(received).toEqual({ x: 1 })
      // GATED: flush does NOT auto-reschedule — idle accumulator => no new rAF.
      expect(rafSpy).toHaveBeenCalledTimes(1)
      expect(pending.size).toBe(0)

      // A fresh write reschedules.
      gate.write("a", { x: 5 })
      expect(rafSpy).toHaveBeenCalledTimes(2)
      fireFrame()
      expect(received).toEqual({ x: 5 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("unregister removes the element and a subsequent write is a no-op", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let received: Patch | undefined
      const unregister = gate.register("a", { kind: "signal", set: (p) => (received = p) })

      unregister()
      gate.write("a", { x: 1 })
      // No-op: nothing registered under "a", so no frame is scheduled.
      expect(rafSpy).not.toHaveBeenCalled()

      fireFrame()
      expect(received).toBeUndefined()

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("dispose cancels a pending frame", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      gate.register("a", { kind: "signal", set: () => {} })
      gate.write("a", { x: 1 })
      expect(rafSpy).toHaveBeenCalledTimes(1)
      expect(pending.size).toBe(1)

      gate.dispose()
      expect(cafSpy).toHaveBeenCalledTimes(1)
      expect(pending.size).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })

  it("useWardicGate-style: the gate batches via solid (runs inside a root owner)", () => {
    // Sanity: solid's batch() the gate uses is safe to call outside a tracking
    // scope, but exercise it within a root to mirror real provider usage.
    createRoot((dispose) => {
      const runtime = ManagedRuntime.make(TestLive)
      const gate = makeFlushGate(runtime)
      let received: Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })
      gate.write("a", { x: 7 })
      fireFrame()
      expect(received).toEqual({ x: 7 })
      gate.dispose()
      void runtime.dispose()
      dispose()
    })
  })
})

describe("makeFlushGate — scheduleMeasure (pre-flush read queue, ADR-0009 / D4)", () => {
  it("runs the measure pass BEFORE the write flush in one frame; a seed write from the pass flushes same-frame", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      const order: Array<string> = []
      let received: Patch | undefined
      gate.register("a", {
        kind: "signal",
        set: (p) => {
          order.push("write")
          received = p
        },
      })

      gate.scheduleMeasure(() => {
        order.push("read")
        gate.write("a", { x: 1 }) // seed value written from within the pass
      })
      // One frame scheduled; nothing has run yet.
      expect(rafSpy).toHaveBeenCalledTimes(1)
      expect(order).toEqual([])

      fireFrame()
      // Reads run BEFORE writes; the seed flushed in the SAME frame.
      expect(order).toEqual(["read", "write"])
      expect(received).toEqual({ x: 1 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("coalesces: the same pass scheduled multiple times in a frame runs once", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let runs = 0
      const pass = (): void => {
        runs++
      }
      gate.scheduleMeasure(pass)
      gate.scheduleMeasure(pass)
      gate.scheduleMeasure(pass)
      expect(rafSpy).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(runs).toBe(1)

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("a write issued from inside a pass does NOT schedule an extra frame (flushing guard)", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      gate.register("a", { kind: "signal", set: () => {} })
      gate.scheduleMeasure(() => gate.write("a", { x: 1 }))
      expect(rafSpy).toHaveBeenCalledTimes(1)

      fireFrame()
      // The in-pass write flushed this frame; it must not have queued another rAF.
      expect(rafSpy).toHaveBeenCalledTimes(1)
      expect(pending.size).toBe(0)

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("dispose clears queued measure passes", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let runs = 0
      gate.scheduleMeasure(() => {
        runs++
      })
      gate.dispose()
      fireFrame()
      expect(runs).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })
})
