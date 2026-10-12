// The flush gate's test harness (ADR-0031), shared by dom's node and browser gate tests: a
// hand-driven Refresh frame source, provided as the Environment's `RefreshFrameSource`, the member
// the gate requests its frames from. It captures each requested callback, so a test fires frames
// deterministically and asserts scheduling through the request and cancel spies and `pending`.
// The gate keeps at most one frame outstanding (gated), so `fireFrame` runs the single pending
// callback. Call `resetFrames()` in a `beforeEach`.
//
// The gate also hooks the end of the Environment's Frame loop's tick (ADR-0033), so its runtime
// needs a loop: `TestLive` and `DomLive` have one, and `stillLoop` is one that never ticks, for
// an Environment without (the Renderer alone).
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import { TestClock } from "@wardic/test"
import * as Layer from "effect/Layer"
import { vi } from "vitest"
import type { FlushGateOptions } from "../src/index.ts"

type FrameCallback = (t: number) => void

const make = () => {
  const pending = new Map<unknown, FrameCallback>()
  let nextId = 1
  const request = vi.fn((cb: FrameCallback): unknown => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  const cancel = vi.fn((id: unknown): void => {
    pending.delete(id)
  })
  return { pending, request, cancel }
}

/** The current test's frames: its pending callbacks, and the source's request and cancel spies. */
export let frames = make()

/** A fresh source for the next test. */
export const resetFrames = (): void => {
  frames = make()
}

/** `env` with the hand-driven source as its Refresh frame source. */
export const withFrames = <A, E>(env: Layer.Layer<A, E>) =>
  Layer.merge(env, RefreshFrameSource.layer({ requestFrame: (cb) => frames.request(cb), cancelFrame: (id) => frames.cancel(id) }))

/** A Frame loop over a Clock that never ticks: the gate's hook is on it and never runs. */
export const stillLoop = FrameLoop.layer.pipe(Layer.provide(TestClock.layer([])))

/** Fire the single outstanding frame callback. */
export const fireFrame = (t = 0): void => {
  const entries = [...frames.pending.entries()]
  const last = entries[entries.length - 1]
  if (last === undefined) return
  frames.pending.delete(last[0])
  last[1](t)
}

/** A binding whose sinks need no batching: `batch` runs the flush as it is. */
export const NO_BATCH: FlushGateOptions = { batch: (apply) => apply() }
