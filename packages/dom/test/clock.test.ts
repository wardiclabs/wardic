// @vitest-environment happy-dom
import { Clock } from "@wardic/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { ClockDomLive } from "../src/clock.ts"

/**
 * A hand-driven requestAnimationFrame: instead of relying on happy-dom's real
 * frame timing, we capture each scheduled callback so the test advances frames
 * deterministically with explicit timestamps (so dt is exact) and so we can
 * assert ref-counting via call counts on rAF/caf.
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

/** Fire the single outstanding rAF callback with timestamp `t` (ms). */
const fireFrame = (t: number): void => {
  // The driver schedules exactly one frame at a time; grab the latest pending.
  const entries = [...pending.entries()]
  const last = entries[entries.length - 1]
  if (last === undefined) return
  pending.delete(last[0])
  last[1](t)
}

/** Hand the scheduler enough turns for the forked rAF loop / stream to drain. */
const flush = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

/**
 * Subscribe to `Clock.ticks` in a child fiber, collecting dt values. `close`
 * interrupts the fiber (closing the subscriber scope -> dropping the rAF
 * ref-count) and drains so finalizers run before the test asserts.
 */
const subscribeTicks = Effect.gen(function* () {
  const clock = yield* Clock
  const received = yield* Ref.make<ReadonlyArray<number>>([])
  const fiber = yield* Effect.forkChild(
    Stream.runForEach(clock.ticks, (dt) => Ref.update(received, (xs) => [...xs, dt])),
  )
  yield* flush
  return {
    received: Ref.get(received),
    close: Fiber.interrupt(fiber).pipe(Effect.andThen(flush)),
  }
})

const TestLayer = Layer.provideMerge(ClockDomLive, AtomRegistry.layer)

describe("ClockDomLive", () => {
  it.effect("no rAF is scheduled until something subscribes", () =>
    Effect.gen(function* () {
      yield* Clock // building the Clock alone must not start the loop
      expect(rafSpy).not.toHaveBeenCalled()
    }).pipe(Effect.provide(TestLayer)))

  it.effect("ticks emits dt across frames: first dt 0, then positive deltas", () =>
    Effect.gen(function* () {
      const sub = yield* subscribeTicks

      // First subscribe acquires the rAF driver: exactly one frame scheduled.
      expect(rafSpy).toHaveBeenCalledTimes(1)

      // Frame 1 @ t=0ms: first-frame dt is 0. After tick, the loop schedules
      // the next frame.
      fireFrame(0)
      yield* flush
      // Frame 2 @ t=16ms: dt = 16/1000 = 0.016s.
      fireFrame(16)
      yield* flush
      // Frame 3 @ t=48ms: dt = 32/1000 = 0.032s.
      fireFrame(48)
      yield* flush

      const dts = yield* sub.received
      expect(dts.length).toBe(3)
      expect(dts[0]).toBeCloseTo(0, 6)
      expect(dts[1]).toBeCloseTo(0.016, 6)
      expect(dts[2]).toBeCloseTo(0.032, 6)

      yield* sub.close
    }).pipe(Effect.provide(TestLayer)))

  it.effect("tick updates the time and dt Atoms (read via the Environment registry)", () =>
    Effect.gen(function* () {
      const clock = yield* Clock
      const sub = yield* subscribeTicks

      // Before any frame: atoms still at their initial 0.
      expect(yield* Atom.get(clock.time)).toBe(0)
      expect(yield* Atom.get(clock.dt)).toBe(0)

      fireFrame(0)
      yield* flush
      fireFrame(100)
      yield* flush

      // time = latest absolute timestamp; dt = last delta in seconds.
      expect(yield* Atom.get(clock.time)).toBe(100)
      expect(yield* Atom.get(clock.dt)).toBeCloseTo(0.1, 6)

      yield* sub.close
    }).pipe(Effect.provide(TestLayer)))

  it.effect("rAF loop is ref-counted: cancelled after the last subscriber leaves", () =>
    Effect.gen(function* () {
      // Two concurrent subscribers share ONE rAF loop.
      const a = yield* subscribeTicks
      const b = yield* subscribeTicks
      expect(rafSpy).toHaveBeenCalledTimes(1)

      // Drive a couple of frames; the loop keeps a single frame outstanding.
      fireFrame(0)
      yield* flush
      fireFrame(16)
      yield* flush
      expect(pending.size).toBe(1)

      // First subscriber leaves: ref-count >= 1, loop still alive (not cancelled).
      yield* a.close
      expect(cafSpy).not.toHaveBeenCalled()
      expect(pending.size).toBe(1)

      // Last subscriber leaves: RcRef releases, the forked fiber is interrupted,
      // and nextFrame's finalizer cancels the outstanding frame.
      yield* b.close
      expect(cafSpy).toHaveBeenCalledTimes(1)
      expect(pending.size).toBe(0)

      // No further frames are produced after teardown: firing a stale id is a
      // no-op (already cancelled), and no new rAF was scheduled.
      const beforeCount = rafSpy.mock.calls.length
      yield* flush
      expect(rafSpy.mock.calls.length).toBe(beforeCount)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("re-subscribing after teardown re-acquires the rAF loop", () =>
    Effect.gen(function* () {
      const a = yield* subscribeTicks
      expect(rafSpy).toHaveBeenCalledTimes(1)
      yield* a.close
      expect(cafSpy).toHaveBeenCalledTimes(1)

      const b = yield* subscribeTicks
      expect(rafSpy).toHaveBeenCalledTimes(2)
      yield* b.close
      expect(cafSpy).toHaveBeenCalledTimes(2)
    }).pipe(Effect.provide(TestLayer)))
})
