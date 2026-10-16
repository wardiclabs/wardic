import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import { DomLive } from "@wardic/dom"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Layer from "effect/Layer"
import { createEffect, createRoot, createSignal, on } from "solid-js"
import { useWardicGate, WardicProvider, type WardicEnv } from "../src/provider.tsx"

/**
 * The flush gate is `@wardic/dom`'s (ADR-0031): its logic is pinned in dom's `gate.node.test.ts`
 * and its commits onto real elements in dom's `gate.browser.test.ts`. What's solid's is what the
 * provider hands it: Solid's `batch()`, for a frame's Starting-style switches (ADR-0034), and the
 * Environment the gate takes its frames from. So each test here gets its gate from a
 * `WardicProvider`, through `useWardicGate`.
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
const providerGate = (env: WardicEnv): FlushGate.FlushGate => {
  let gate: FlushGate.FlushGate | undefined
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
      const el = document.createElement("div")
      gate.register("a", { target: el })
      gate.write("a", { opacity: 0.5 })
      expect(rafSpy).toHaveBeenCalledTimes(1)
      expect(globalRequest).not.toHaveBeenCalled()

      fireFrame()
      expect(el.style.opacity).toBe("0.5")
      expect(globalRequest).not.toHaveBeenCalled()
    } finally {
      globalRequest.mockRestore()
    }
  })
})

describe("the provider's gate and Solid (ADR-0034)", () => {
  it("a frame's Starting-style switches run in one batch(): an effect reading two of them runs once, before either commit", () => {
    const gate = providerGate(withFrames(DomLive))
    const a = document.createElement("div")
    const b = document.createElement("div")
    const runs: Array<[boolean, boolean, string, string]> = []
    // Effects go live once the root's setup returns, so the flush runs after it.
    const disposeRoot = createRoot((dispose) => {
      const [switchedA, setSwitchedA] = createSignal(false)
      const [switchedB, setSwitchedB] = createSignal(false)
      gate.register("a", { target: a, beforeFirstCommit: () => setSwitchedA(true) })
      gate.register("b", { target: b, beforeFirstCommit: () => setSwitchedB(true) })
      createEffect(
        on([switchedA, switchedB], ([va, vb]) => runs.push([va, vb, a.style.opacity, b.style.opacity]), { defer: true }),
      )
      return dispose
    })

    gate.write("a", { opacity: 0.5 })
    gate.write("b", { opacity: 0.25 })
    fireFrame()
    expect(runs).toEqual([[true, true, "", ""]])
    expect(a.style.opacity).toBe("0.5")
    expect(b.style.opacity).toBe("0.25")
    disposeRoot()
  })

  it("a signal the keys-held hook sets has run its effects before the commit", () => {
    const gate = providerGate(withFrames(DomLive))
    const el = document.createElement("div")
    const seen: Array<[ReadonlyArray<string>, string]> = []
    const disposeRoot = createRoot((dispose) => {
      const [held, setHeld] = createSignal<ReadonlyArray<string>>([])
      gate.register("a", { target: el, onHeld: (keys) => setHeld(keys) })
      createEffect(on(held, (keys) => seen.push([keys, el.style.opacity]), { defer: true }))
      return dispose
    })

    gate.write("a", { opacity: 0.5 })
    fireFrame()
    expect(seen).toEqual([[["opacity"], ""]])
    expect(el.style.opacity).toBe("0.5")
    disposeRoot()
  })
})
