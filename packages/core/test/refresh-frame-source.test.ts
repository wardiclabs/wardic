import * as Clock from "@wardic/core/Clock"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"

// The Environment's Refresh frame source as a member (ADR-0031): `Clock.layer` builds the Clock
// from it, and a source that keeps the contract's order rules gives every requester the browser's
// order without the browser: a frame requested during a tick (a flush gate's request for a write
// made outside the Frame loop's tick, ADR-0033) runs in the next Refresh frame, before its tick.

/**
 * A source that keeps the contract, as `requestAnimationFrame` does: `fire` runs the callbacks
 * requested before it, in request order, and one requested while they run waits for the next
 * `fire`. `requests` counts every request.
 */
const makeFrames = () => {
  const pending = new Map<unknown, (t: number) => void>()
  let nextHandle = 1
  let requests = 0
  const source: RefreshFrameSource.Shape = {
    requestFrame: (callback) => {
      const handle = nextHandle++
      pending.set(handle, callback)
      requests++
      return handle
    },
    cancelFrame: (handle) => {
      pending.delete(handle)
    },
  }
  /** Run the callbacks requested so far at timestamp `t` (ms), in request order. */
  const fire = (t: number): void => {
    for (const handle of [...pending.keys()]) {
      const callback = pending.get(handle)
      if (callback === undefined) continue
      pending.delete(handle)
      callback(t)
    }
  }
  return { source, pending, fire, requests: () => requests }
}

/** The Clock built by `Clock.layer` over `source`, as an Environment builds it. */
const makeRuntime = async (source: RefreshFrameSource.Shape) => {
  const runtime = ManagedRuntime.make(Clock.layer.pipe(Layer.provideMerge(RefreshFrameSource.layer(source))))
  const clock = await runtime.runPromise(Effect.service(Clock.Clock))
  return { runtime, clock }
}

/** The end of the current task: one microtask checkpoint later. */
const endOfTask = (): Promise<void> => Promise.resolve()

describe("RefreshFrameSource", () => {
  it("is the member Clock.layer builds the Clock from: the Clock's frames are its requests", async () => {
    const frames = makeFrames()
    const { runtime, clock } = await makeRuntime(frames.source)
    expect(await runtime.runPromise(Effect.service(RefreshFrameSource.RefreshFrameSource))).toBe(frames.source)

    const received: Array<number> = []
    runtime.runFork(Stream.runForEach(clock.ticks, (dt) => Effect.sync(() => void received.push(dt))))
    expect(frames.requests()).toBe(0)
    await endOfTask()
    expect(received).toEqual([]) // no Priming tick (ADR-0033)
    expect(frames.requests()).toBe(1) // the loop asks the member for its first Refresh frame

    frames.fire(1000)
    expect(received).toEqual([Clock.NOMINAL_DT])
    expect(frames.requests()).toBe(2) // each next frame from inside the last one's callback
    await runtime.dispose()
    expect(frames.pending.size).toBe(0) // closing the Environment cancels the pending request
  })

  it("keeps a second requester's order: a frame requested during a tick runs in the next Refresh frame, before its tick", async () => {
    const frames = makeFrames()
    const { runtime, clock } = await makeRuntime(frames.source)
    // A gate-shaped requester: each tick writes, and the first write in a frame requests a flush.
    const events: Array<string> = []
    let scheduled = false
    const flush = (): void => {
      scheduled = false
      events.push("flush")
    }
    runtime.runFork(
      Stream.runForEach(clock.ticks, () =>
        Effect.sync(() => {
          events.push("tick")
          if (scheduled) return
          scheduled = true
          frames.source.requestFrame(flush)
        })),
    )
    await endOfTask()
    expect(events).toEqual([])

    frames.fire(1000)
    expect(events).toEqual(["tick"]) // the tick's request, made during the frame's callbacks, waits
    frames.fire(1016)
    expect(events).toEqual(["tick", "flush", "tick"]) // request order: the flush, then the tick
    frames.fire(1033)
    expect(events).toEqual(["tick", "flush", "tick", "flush", "tick"])
    await runtime.dispose()
  })
})
