// The Solid 2 provider's flush gate (#209, ADR-0031, ADR-0034), as the Solid 1 binding's gate
// tests pin it: its frames come from the Environment, and a frame's Starting-style switches run in
// the binding's `batch`, here apply-then-`flush()`, so their effects have run before any commit.
//
// - G1: the gate requests its flush from the Environment's RefreshFrameSource, never the global.
// - G2: a frame's switches run together: an effect reading two of them runs once, before either commit.
// - G3: a signal the keys-held hook sets has run its effects before the commit.
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import { DomLive } from "@wardic/dom"
import type * as FlushGate from "@wardic/dom/FlushGate"
import { useWardicGate, type WardicEnv, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Layer from "effect/Layer"
import { createEffect, createRoot, createSignal } from "solid-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { mount } from "./mount.tsx"

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

/** `env` with the hand-driven source as its Refresh frame source. */
const withFrames = (env: WardicEnv): WardicEnv =>
  Layer.merge(env, RefreshFrameSource.layer({ requestFrame: rafSpy, cancelFrame: (id) => void pending.delete(id) }))

/** Fire the single outstanding frame callback. */
const fireFrame = (t = 0): void => {
  const entries = [...pending.entries()]
  const last = entries[entries.length - 1]
  if (last === undefined) return
  pending.delete(last[0])
  last[1](t)
}

/** The gate a `WardicProvider` on `env` builds, as `useWardicGate` returns it. */
const providerGate = (env: WardicEnv): FlushGate.Shape => {
  let gate: FlushGate.Shape | undefined
  const Probe = () => {
    gate = useWardicGate()
    return null
  }
  mount(() => (
    <WardicProvider env={env}>
      <Probe />
    </WardicProvider>
  ))
  return gate!
}

describe("the Solid 2 provider's gate takes its frames from the Environment (ADR-0031)", () => {
  it("G1: it requests its flush from the Environment's RefreshFrameSource, never from the global", () => {
    const gate = providerGate(withFrames(DomLive))
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

describe("the Solid 2 provider's gate and Solid (ADR-0034)", () => {
  it("G2: a frame's Starting-style switches run together: an effect reading two of them runs once, before either commit", () => {
    const gate = providerGate(withFrames(DomLive))
    const a = document.createElement("div")
    const b = document.createElement("div")
    const runs: Array<[boolean, boolean, string, string]> = []
    const [switchedA, setSwitchedA] = createSignal(false)
    const [switchedB, setSwitchedB] = createSignal(false)
    const disposeRoot = createRoot((dispose) => {
      createEffect(
        () => [switchedA(), switchedB()] as const,
        ([va, vb]) => {
          runs.push([va, vb, a.style.opacity, b.style.opacity])
        },
        { defer: true },
      )
      return dispose
    })
    gate.register("a", { target: a, beforeFirstCommit: () => setSwitchedA(true) })
    gate.register("b", { target: b, beforeFirstCommit: () => setSwitchedB(true) })
    gate.write("a", { opacity: 0.5 })
    gate.write("b", { opacity: 0.25 })
    fireFrame()
    expect(runs).toEqual([[true, true, "", ""]])
    expect(a.style.opacity).toBe("0.5")
    expect(b.style.opacity).toBe("0.25")
    disposeRoot()
  })

  it("G3: a signal the keys-held hook sets has run its effects before the commit", () => {
    const gate = providerGate(withFrames(DomLive))
    const el = document.createElement("div")
    const seen: Array<[ReadonlyArray<string>, string]> = []
    const [held, setHeld] = createSignal<ReadonlyArray<string>>([])
    const disposeRoot = createRoot((dispose) => {
      createEffect(
        held,
        (keys) => {
          seen.push([keys, el.style.opacity])
        },
        { defer: true },
      )
      return dispose
    })
    // The keys-held hook runs in the gate's batch only with a first commit waiting (ADR-0034).
    gate.register("a", { target: el, beforeFirstCommit: () => {}, onHeld: (keys) => setHeld(keys) })
    gate.write("a", { opacity: 0.5 })
    fireFrame()
    expect(seen).toEqual([[["opacity"], ""]])
    expect(el.style.opacity).toBe("0.5")
    disposeRoot()
  })
})
