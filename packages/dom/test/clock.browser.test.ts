import { Clock, NOMINAL_DT } from "@wardic/core"
import { afterEach, describe, expect, it, vi } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { AtomRegistry } from "effect/unstable/reactivity"
import { ClockDomLive } from "../src/clock.ts"

/**
 * `ClockDomLive` is core's `makeRefreshFrameClock` over the browser's REAL
 * `requestAnimationFrame` / `cancelAnimationFrame` (spied on, not stubbed). The
 * Clock's own contract — the Priming tick, the dt sequence, ref-counting, and no
 * Effect-scheduler dependence — is pinned in core's node tests
 * (`packages/core/test/refresh-frame-clock.test.ts`); these check the wiring: the
 * real functions are called (detached, so no "Illegal invocation"), and releasing
 * the last subscriber cancels the pending Refresh frame.
 */
const raf = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** Build ClockDomLive (after any spy is installed — the Layer captures the functions). */
const buildClock = async () => {
  const runtime = ManagedRuntime.make(Layer.provideMerge(ClockDomLive, AtomRegistry.layer))
  const clock = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* Clock
    }),
  )
  /** Subscribe synchronously, so the caller can observe the end of the subscribing task. */
  const subscribe = () => {
    const received: Array<number> = []
    const fiber = runtime.runFork(Stream.runForEach(clock.ticks, (dt) => Effect.sync(() => void received.push(dt))))
    return {
      received,
      close: async () => {
        await runtime.runPromise(Fiber.interrupt(fiber))
        await runtime.dispose()
      },
    }
  }
  return { subscribe }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ClockDomLive", () => {
  it("ticks on the real requestAnimationFrame: the Priming tick, then measured Refresh frames", async () => {
    const requestSpy = vi.spyOn(window, "requestAnimationFrame")
    const sub = (await buildClock()).subscribe()
    expect(sub.received).toEqual([])
    expect(requestSpy).not.toHaveBeenCalled()

    await Promise.resolve() // the end of the subscribing task
    expect(sub.received).toEqual([NOMINAL_DT])
    expect(requestSpy).toHaveBeenCalledTimes(1)

    await raf()
    await raf()
    await raf()
    expect(sub.received.length).toBeGreaterThanOrEqual(3)
    expect(sub.received[1]).toBeCloseTo(NOMINAL_DT, 9) // first Refresh frame: nothing to measure against yet
    expect(sub.received[2]).toBeGreaterThan(0) // a real, measured interval
    await sub.close()
  })

  it("releasing the last subscriber calls cancelAnimationFrame and stops ticking", async () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame")
    const sub = (await buildClock()).subscribe()
    await Promise.resolve()
    await raf()
    expect(cancelSpy).not.toHaveBeenCalled()

    await sub.close()
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    const count = sub.received.length
    await raf()
    await raf()
    expect(sub.received.length).toBe(count)
  })
})
