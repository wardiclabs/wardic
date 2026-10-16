import * as Clock from "@wardic/core/Clock"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import { afterEach, describe, expect, it, vi } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { AtomRegistry } from "effect/reactivity"
import { ClockDomLive } from "../src/internal/clock.ts"

/**
 * `ClockDomLive` is core's `Clock.layer` over the browser's REAL
 * `requestAnimationFrame` / `cancelAnimationFrame` (spied on, not stubbed), which it also
 * provides as the Environment's `RefreshFrameSource` for the flush gate (ADR-0031). The
 * Clock's own contract — the first Refresh frame's nominal dt, the dt sequence, ref-counting, and no
 * Effect-scheduler dependence — is pinned in core's node tests
 * (`packages/core/test/refresh-frame-clock.test.ts`); these check the wiring: the
 * real functions are called (detached, so no "Illegal invocation"), the loop stops
 * at the Refresh frame after the last subscriber leaves, and tearing the Layer down
 * cancels a pending request.
 */
const raf = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** Build ClockDomLive (after any spy is installed — the Layer captures the functions). */
const buildClock = async () => {
  const runtime = ManagedRuntime.make(Layer.provideMerge(ClockDomLive, AtomRegistry.layer))
  const clock = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* Clock.Clock
    }),
  )
  /** Subscribe synchronously, so the caller can observe the end of the subscribing task. */
  const subscribe = () => {
    const received: Array<number> = []
    const fiber = runtime.runFork(Stream.runForEach(clock.ticks, (dt) => Effect.sync(() => void received.push(dt))))
    return { received, unsubscribe: () => runtime.runPromise(Fiber.interrupt(fiber)) }
  }
  const frames = await runtime.runPromise(Effect.service(RefreshFrameSource.RefreshFrameSource))
  return { subscribe, frames, dispose: () => runtime.dispose() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ClockDomLive", () => {
  it("ticks on the real requestAnimationFrame: the first Refresh frame with the nominal dt, then measured ones", async () => {
    const requestSpy = vi.spyOn(window, "requestAnimationFrame")
    const env = await buildClock()
    const sub = env.subscribe()
    expect(sub.received).toEqual([])
    expect(requestSpy).not.toHaveBeenCalled()

    await Promise.resolve() // the end of the subscribing task
    expect(sub.received).toEqual([]) // no Priming tick (ADR-0033)
    expect(requestSpy).toHaveBeenCalledTimes(1)

    await raf()
    await raf()
    await raf()
    expect(sub.received.length).toBeGreaterThanOrEqual(2)
    expect(sub.received[0]).toBeCloseTo(Clock.NOMINAL_DT, 9) // first Refresh frame: nothing to measure against yet
    expect(sub.received[1]).toBeGreaterThan(0) // a real, measured interval
    await sub.unsubscribe()
    await env.dispose()
  })

  it("after the last subscriber leaves, the loop stops at the next Refresh frame; tearing down cancels a pending one", async () => {
    const requestSpy = vi.spyOn(window, "requestAnimationFrame")
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame")
    const env = await buildClock()
    const sub = env.subscribe()
    await Promise.resolve()
    await raf()
    await sub.unsubscribe()
    const requests = requestSpy.mock.calls.length
    await raf() // the loop's pending Refresh frame finds nobody and ends the loop
    await raf()
    expect(requestSpy.mock.calls.length).toBe(requests + 2) // only this test's own two raf() calls
    expect(cancelSpy).not.toHaveBeenCalled()

    // A running loop's pending request is cancelled when the Clock's Layer is torn down.
    const again = env.subscribe()
    await Promise.resolve()
    await raf()
    await env.dispose()
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    const count = again.received.length
    await raf()
    expect(again.received.length).toBe(count)
  })

  it("provides the Environment's RefreshFrameSource: the requestAnimationFrame it was built with, the pair the Clock runs on", async () => {
    const requestSpy = vi.spyOn(window, "requestAnimationFrame")
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame")
    const env = await buildClock()
    // The member's requestFrame is the global itself (the spy installed before the build), not a wrapper.
    expect(env.frames.requestFrame).toBe(requestSpy)
    const { requestFrame, cancelFrame } = env.frames
    let ran = false
    const handle = requestFrame(() => {
      ran = true
    })
    expect(requestSpy).toHaveBeenCalledTimes(1) // called detached, with no "Illegal invocation"
    cancelFrame(handle)
    expect(cancelSpy).toHaveBeenCalledWith(handle)
    await raf()
    expect(ran).toBe(false)

    // The Clock's frames go through the same pair.
    const before = requestSpy.mock.calls.length // this test's own raf() included
    const sub = env.subscribe()
    await Promise.resolve()
    expect(requestSpy.mock.calls.length).toBe(before + 1)
    await sub.unsubscribe()
    await env.dispose()
  })
})
