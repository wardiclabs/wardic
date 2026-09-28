import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Patch } from "@wardic/core"
import { DomLive } from "@wardic/dom"
import { TestLive } from "@wardic/test"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { createEffect, createRoot, createSignal, on } from "solid-js"
import { makeFlushGate } from "../src/gate.ts"

/**
 * Hand-driven requestAnimationFrame (mirrors packages/dom/test/clock.test.ts):
 * capture each scheduled callback so the test fires frames deterministically
 * and asserts scheduling via rAF/caf call counts. The gate keeps at most one
 * frame outstanding (gated), so `fireFrame` runs the single pending callback.
 *
 * This stubs rAF/caf synchronously — the gate flush is NOT an Effect fiber, so
 * this deterministic approach runs as-is in a real browser.
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

  it("commit sink writes the projected patch onto an element's style", () => {
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

describe("makeFlushGate — flushPass (the Measure pass flush; ADR-0018, ADR-0006 amendment)", () => {
  it("runs the pass synchronously and applies exactly what it wrote before returning, with no frame fired", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      const order: Array<string> = []
      let received: Patch | undefined
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
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let a: Patch | undefined
      let b: Patch | undefined
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

  it("applies everything the pass wrote inside one batch(): an effect reading two of them runs once", () => {
    const runtime = ManagedRuntime.make(TestLive)
    const gate = makeFlushGate(runtime)
    const runs: Array<[Patch | undefined, Patch | undefined]> = []
    // Effects go live once the root's setup returns, so the pass runs after it.
    const disposeRoot = createRoot((dispose) => {
      const [a, setA] = createSignal<Patch | undefined>(undefined)
      const [b, setB] = createSignal<Patch | undefined>(undefined)
      gate.register("a", { kind: "signal", set: setA })
      gate.register("b", { kind: "signal", set: setB })
      createEffect(on([a, b], ([va, vb]) => runs.push([va, vb]), { defer: true }))
      return dispose
    })

    gate.flushPass(() => {
      gate.write("a", { x: 1 })
      gate.write("b", { y: 2 })
    })
    expect(runs).toEqual([[{ x: 1 }, { y: 2 }]])

    gate.dispose()
    void runtime.dispose()
    disposeRoot()
  })

  it("commits a commit-sink entry the pass wrote through the Renderer", () => {
    const runtime = ManagedRuntime.make(DomLive)
    try {
      const gate = makeFlushGate(runtime)
      const el = document.createElement("div")
      gate.register("el", { kind: "commit", target: el })

      gate.flushPass(() => gate.write("el", { x: 10 }))
      expect(el.style.transform).toBe("translateX(10px)")

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("the next frame does not re-apply an entry the pass flushed unless it was written again", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
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

  it("a write from an effect inside the pass's flush waits for the next frame, and requests it", () => {
    const runtime = ManagedRuntime.make(TestLive)
    const gate = makeFlushGate(runtime)
    let b: Patch | undefined
    const disposeRoot = createRoot((dispose) => {
      const [a, setA] = createSignal<Patch | undefined>(undefined)
      gate.register("a", { kind: "signal", set: setA })
      gate.register("b", { kind: "signal", set: (p) => (b = p) })
      // Runs inside flushPass's batch(), after the pass itself has returned.
      createEffect(on(a, () => gate.write("b", { y: 1 }), { defer: true }))
      return dispose
    })

    gate.flushPass(() => gate.write("a", { x: 1 }))
    expect(b).toBeUndefined() // not part of the pass
    expect(pending.size).toBe(1) // but not stranded either: the next frame is requested

    fireFrame() // the frame the pass's own write requested also applies b
    expect(b).toEqual({ y: 1 })

    gate.dispose()
    void runtime.dispose()
    disposeRoot()
  })

  it("has no measure read-queue any more", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      expect("scheduleMeasure" in gate).toBe(false)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("after dispose, a pass applies nothing and requests no frame", () => {
    const runtime = ManagedRuntime.make(TestLive)
    try {
      const gate = makeFlushGate(runtime)
      let applied = 0
      gate.register("a", { kind: "signal", set: () => applied++ })
      gate.dispose()

      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(applied).toBe(0)
      expect(pending.size).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })
})
