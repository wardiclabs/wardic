// The flush gate's commits onto a real element (ADR-0006, framework-free in dom since ADR-0031;
// one sink shape since ADR-0034), on `DomLive`'s Renderer and a hand-driven Refresh frame source
// provided as the Environment's member (`gate-harness.ts`). The gate's logic is in
// `gate.node.test.ts`.
import * as Projection from "@wardic/core/Projection"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { beforeEach, describe, expect, it } from "vitest"
import { DomLive, makeFlushGate } from "../src/index.ts"
import { fireFrame, NO_BATCH, resetFrames, withFrames } from "./gate-harness.ts"

beforeEach(resetFrames)

describe("makeFlushGate — commits onto an element", () => {
  it("a sink's element gets the projected patch written onto its style", () => {
    // DomLive so project groups transforms / applies units and commit writes style.
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      gate.register("el", { target: el })

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

  it("flushPass commits an entry the pass wrote through the Renderer", () => {
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      gate.register("el", { target: el })

      gate.flushPass(() => gate.write("el", { x: 10 }))
      expect(el.style.transform).toBe("translateX(10px)")

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

// The raise's reset (ADR-0016, *Amendment (Reorder)*): the gate removes a key its previous
// patch had and this one doesn't, restoring the element's own inline value.
describe("makeFlushGate — a key that drops out of a patch", () => {
  const IDENTITY: Projection.Delta = {
    x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
    y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  }
  const raised = { [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 }, raise: 1 } }
  const lowered = { [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 } } }

  it("GK1: the gate removes z-index once the projection stops carrying the raise", () => {
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      gate.register("el", { target: el })
      gate.write("el", raised)
      fireFrame()
      expect(el.style.getPropertyValue("z-index")).toBe("1")
      gate.write("el", lowered)
      fireFrame()
      expect(el.style.getPropertyValue("z-index")).toBe("")
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GK2: the gate restores the element's own inline value it overwrote", () => {
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      el.style.setProperty("z-index", "5")
      gate.register("el", { target: el })
      gate.write("el", raised)
      fireFrame()
      expect(el.style.getPropertyValue("z-index")).toBe("1")
      gate.write("el", lowered)
      fireFrame()
      expect(el.style.getPropertyValue("z-index")).toBe("5")
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

describe("makeFlushGate — release (#47, ADR-0022): a key handed back to the element's own style", () => {
  it("GR2: the gate writes the value it's handed for a released key", () => {
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      el.style.setProperty("opacity", "0.3")
      gate.register("el", { target: el })
      gate.write("el", { opacity: 0.5 })
      fireFrame()
      expect(el.style.opacity).toBe("0.5")
      gate.release("el", ["opacity"], { opacity: "0.8" })
      fireFrame()
      expect(el.style.opacity).toBe("0.8")
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GR3: without one, the gate restores the inline value it overwrote", () => {
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      el.style.setProperty("opacity", "0.3")
      gate.register("el", { target: el })
      gate.write("el", { opacity: 0.5, x: 4 })
      fireFrame()
      gate.release("el", ["opacity"])
      fireFrame()
      expect(el.style.opacity).toBe("0.3")
      expect(el.style.transform).toBe("translateX(4px)")
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GR5: a write after a release brings the key back", () => {
    const runtime = ManagedRuntime.make(withFrames(DomLive))
    try {
      const gate = makeFlushGate(runtime, NO_BATCH)
      const el = document.createElement("div")
      gate.register("el", { target: el })
      gate.write("el", { opacity: 0.5 })
      fireFrame()
      gate.release("el", ["opacity"], { opacity: "0.8" })
      fireFrame()
      gate.write("el", { opacity: 0.6 })
      fireFrame()
      expect(el.style.opacity).toBe("0.6")
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})
