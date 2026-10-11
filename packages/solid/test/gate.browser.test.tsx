import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import { DomLive, type FlushGate } from "@wardic/dom"
import { TestLive } from "@wardic/test"
import * as Layer from "effect/Layer"
import { createEffect, createRoot, createSignal, on } from "solid-js"
import { useWardicGate, WardicProvider, type WardicEnv } from "../src/provider.tsx"

/**
 * The flush gate is `@wardic/dom`'s (ADR-0031): its logic is pinned in dom's `gate.node.test.ts`
 * and its commit sinks in dom's `gate.browser.test.ts`. What's solid's is what the provider hands
 * it: Solid's `batch()`, and the Environment the gate takes its frames from. So each test here
 * gets its gate from a `WardicProvider`, through `useWardicGate`.
 *
 * A hand-driven Refresh frame source, provided as the Environment's `RefreshFrameSource`,
 * captures each requested callback, so a test fires frames deterministically. No global is
 * stubbed: the gate never calls `requestAnimationFrame` itself.
 */
type RafCallback = (t: number) => void

let pending: Map<unknown, RafCallback>
let nextId: number
let rafSpy: ReturnType<typeof vi.fn<(cb: RafCallback) => unknown>>

beforeEach(() => {
  pending = new Map()
  nextId = 1
  rafSpy = vi.fn((cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
})

afterEach(() => {
  cleanup()
})

/** `env` with the hand-driven source as its Refresh frame source. */
function withFrames(env: WardicEnv): WardicEnv {
  return Layer.merge(env, RefreshFrameSource.layer({ requestFrame: rafSpy, cancelFrame: (id) => void pending.delete(id) }))
}

/** Fire the single outstanding frame callback. */
const fireFrame = (t = 0): void => {
  const entries = [...pending.entries()]
  const last = entries[entries.length - 1]
  if (last === undefined) return
  pending.delete(last[0])
  last[1](t)
}

/** The gate a `WardicProvider` on `env` builds, as `useWardicGate` returns it. */
const providerGate = (env: WardicEnv): FlushGate => {
  let gate: FlushGate | undefined
  function Probe() {
    gate = useWardicGate()
    return null
  }
  render(() => (
    <WardicProvider env={env}>
      <Probe />
    </WardicProvider>
  ))
  return gate!
}

describe("the provider's gate takes its frames from the Environment (ADR-0031)", () => {
  it("a provider's gate requests its flush from the Environment's RefreshFrameSource, never from the global", () => {
    const gate = providerGate(withFrames(DomLive))
    // Spied after the runtime built: only a direct call to the global could reach it.
    const globalRequest = vi.spyOn(window, "requestAnimationFrame")
    try {
      let received: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })
      gate.write("a", { opacity: 0.5 })
      expect(rafSpy).toHaveBeenCalledTimes(1)
      expect(globalRequest).not.toHaveBeenCalled()

      fireFrame()
      expect(received).toEqual({ opacity: 0.5 })
      expect(globalRequest).not.toHaveBeenCalled()
    } finally {
      globalRequest.mockRestore()
    }
  })
})

describe("the provider's gate applies through Solid's batch()", () => {
  it("a frame flush inside a root owner applies the patch", () => {
    const gate = providerGate(withFrames(TestLive))
    createRoot((dispose) => {
      let received: Renderer.Patch | undefined
      gate.register("a", { kind: "signal", set: (p) => (received = p) })
      gate.write("a", { x: 7 })
      fireFrame()
      expect(received).toEqual({ x: 7 })
      dispose()
    })
  })

  it("applies everything a pass wrote inside one batch(): an effect reading two of them runs once", () => {
    const gate = providerGate(withFrames(TestLive))
    const runs: Array<[Renderer.Patch | undefined, Renderer.Patch | undefined]> = []
    // Effects go live once the root's setup returns, so the pass runs after it.
    const disposeRoot = createRoot((dispose) => {
      const [a, setA] = createSignal<Renderer.Patch | undefined>(undefined)
      const [b, setB] = createSignal<Renderer.Patch | undefined>(undefined)
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
    disposeRoot()
  })

  it("a write from an effect inside the pass's flush waits for the next frame, and requests it", () => {
    const gate = providerGate(withFrames(TestLive))
    let b: Renderer.Patch | undefined
    const disposeRoot = createRoot((dispose) => {
      const [a, setA] = createSignal<Renderer.Patch | undefined>(undefined)
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
    disposeRoot()
  })
})
