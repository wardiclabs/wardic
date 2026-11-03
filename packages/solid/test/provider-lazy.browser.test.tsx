// A client `WardicProvider` builds on first need (#51, ADR-0021 *Amendment (#51)*): the runtime
// on its first run, and the gate, the projection system and the reduced-motion inputs together,
// the first time a Wardic element or hook reads one, during that element's render.
//
// - LZ1: a provider with nothing from Wardic under it builds nothing at its render: its runtime is
//   unbuilt, with no media query read and no listener added. It builds at the browser's idle time once
//   it has mounted (#535, ADR-0021 *Amendment (#535)*).
// - LZ2: the first Wardic element builds it, during its render: built when `render` returns, one
//   gate however many times it's read, and the element animates.
// - LZ3: a provider unmounted before it's idle unmounts cleanly, and never builds: its idle build is
//   cancelled (#535).
// - LZ4: a provider that built disposes what it built on unmount (its projection system's
//   resize listener goes).
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DomLive } from "@wardic/dom"
import type * as FlushGate from "@wardic/dom/FlushGate"
import { useWardicGate, useWardicRuntime, wardic, WardicProvider, type WardicRuntime } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { raf, until } from "./browser-helpers.ts"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Spies on what a built DomLive sets up: the reduced-motion media query, and window `resize` listeners. */
const spies = () => {
  const matchMedia = vi.spyOn(window, "matchMedia")
  const listen = vi.spyOn(window, "addEventListener")
  return {
    mediaQueries: () => matchMedia.mock.calls.length,
    resizeListeners: () => listen.mock.calls.filter(([type]) => type === "resize").length,
  }
}

/** Grabs the provider's runtime: reading it from context builds nothing. */
const Grab = (props: { readonly into: (runtime: WardicRuntime) => void }) => {
  props.into(useWardicRuntime())
  return <p>static</p>
}

describe("a client WardicProvider builds on first need (#51)", () => {
  it("LZ1: a provider with nothing from Wardic under it builds nothing at its render, and builds at idle", async () => {
    const seen = spies()
    let runtime: WardicRuntime | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <Grab into={(r) => (runtime = r)} />
      </WardicProvider>
    ))
    expect(runtime!.cachedContext, "the runtime: unbuilt at its render").toBeUndefined()
    expect(seen.mediaQueries(), "no media query read at its render").toBe(0)
    expect(seen.resizeListeners(), "no resize listener at its render").toBe(0)
    await until(() => runtime!.cachedContext !== undefined, 2000, "built at idle")
    expect(seen.mediaQueries(), "its media query read at idle").toBeGreaterThan(0)
  })

  it("LZ2: the first Wardic element builds it during its render; one gate however often it's read; it animates", async () => {
    let runtime: WardicRuntime | undefined
    const gates: Array<FlushGate.Shape> = []
    const ReadsGate = () => {
      gates.push(useWardicGate(), useWardicGate())
      return null
    }
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <Grab into={(r) => (runtime = r)} />
        <wardic.div ref={(node: HTMLElement) => (el = node)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        <ReadsGate />
        <ReadsGate />
      </WardicProvider>
    ))
    expect(runtime!.cachedContext, "built by the time render returns").toBeDefined()
    expect(gates.length).toBe(4)
    expect(new Set(gates).size, "one gate").toBe(1)
    await until(() => Number(el!.style.opacity) >= 0.99)
    expect(Number(el!.style.opacity)).toBeGreaterThanOrEqual(0.99)
  })

  it("LZ3: a provider unmounted before it's idle unmounts cleanly, and never builds", async () => {
    const seen = spies()
    let runtime: WardicRuntime | undefined
    const errors: Array<unknown> = []
    const onError = (e: ErrorEvent | PromiseRejectionEvent) =>
      errors.push(Bool.match("reason" in e, { onTrue: () => (e as PromiseRejectionEvent).reason, onFalse: () => (e as ErrorEvent).error }))
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onError)
    render(() => (
      <WardicProvider env={DomLive}>
        <Grab into={(r) => (runtime = r)} />
      </WardicProvider>
    ))
    cleanup()
    await frames(10)
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onError)
    expect(errors).toEqual([])
    expect(runtime!.cachedContext, "still unbuilt").toBeUndefined()
    expect(seen.mediaQueries(), "no media query read").toBe(0)
  })

  it("LZ4: a provider that built disposes what it built on unmount: the projection system's resize listener goes", async () => {
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div layout style={{ width: "40px", height: "40px" }} />
      </WardicProvider>
    ))
    await frames(2)
    const listeners = add.mock.calls.filter(([type]) => type === "resize").map(([, fn]) => fn)
    expect(listeners.length, "a layout node: the projection system listens for resizes").toBeGreaterThan(0)
    cleanup()
    await frames(2)
    const removed = new Set(remove.mock.calls.filter(([type]) => type === "resize").map(([, fn]) => fn))
    expect(listeners.filter((fn) => !removed.has(fn)), "every resize listener removed").toEqual([])
  })
})
