// The flush gate (ADR-0006), framework-free in dom (ADR-0031): its logic in the node tier, on a
// hand-driven Refresh frame source provided as the Environment's member (`gate-harness.ts`) and a
// `batch` handed in as a binding would. Each sink's target hears the patches the gate commits
// onto it (`sinkOf`, ADR-0034). What needs a real element is in `gate.browser.test.ts`, and what
// needs Solid's `batch` in solid's own gate tests. The gate's flush at the end of the Frame
// loop's tick (ADR-0033) runs on a loop over `TestClock.pushable()`.
import * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import * as Projection from "@wardic/core/Projection"
import type * as Renderer from "@wardic/core/Renderer"
import { TestClock } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { beforeEach, describe, expect, it } from "vitest"
import { fireFrame, frames, HEARD, HEARD_DOM, NO_BATCH, resetFrames, sinkOf, stillLoop, withFrames } from "./gate-harness.ts"
import * as internalGate from "../src/internal/gate.ts"

beforeEach(resetFrames)

describe("makeFlushGate", () => {
  it("a sink's target is committed the projected patch after one fired frame (1-frame latency)", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      gate.register("a", sinkOf((p) => (received = p)))

      gate.write("a", { x: 1 })
      // Before the frame: nothing is committed.
      expect(received).toBeUndefined()
      expect(frames.request).toHaveBeenCalledTimes(1)

      fireFrame()
      // HEARD's project is identity, so the patch mirrors the value-map.
      expect(received).toEqual({ x: 1 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("one flush per frame commits every registered element together", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let applied = 0
      const seen: Array<Renderer.Patch> = []
      const heard = (p: Renderer.Patch): void => {
        applied++
        seen.push(p)
      }
      gate.register("a", sinkOf(heard))
      gate.register("b", sinkOf(heard))

      gate.write("a", { x: 1 })
      gate.write("b", { y: 2 })
      // Two writes, but the gate schedules a single frame.
      expect(frames.request).toHaveBeenCalledTimes(1)
      expect(applied).toBe(0)

      fireFrame()
      // Both elements applied in the single fired frame.
      expect(applied).toBe(2)
      expect(seen).toContainEqual({ x: 1 })
      expect(seen).toContainEqual({ y: 2 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("runs a frame's Starting-style switches in one batch, before any commit; later frames and a pass run none (ADR-0034)", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const events: Array<string> = []
      const gate = internalGate.makeFlushGate(runtime, {
        batch: (apply) => {
          events.push("batch")
          apply()
          events.push("end")
        },
      })
      gate.register("a", sinkOf(() => void events.push("commit a"), { beforeFirstCommit: () => void events.push("switch a") }))
      gate.register("b", sinkOf(() => void events.push("commit b"), { beforeFirstCommit: () => void events.push("switch b") }))

      gate.write("a", { x: 1 })
      gate.write("b", { y: 2 })
      expect(events).toEqual([]) // a write applies nothing
      fireFrame()
      expect(events).toEqual(["batch", "switch a", "switch b", "end", "commit a", "commit b"])

      events.length = 0
      gate.write("a", { x: 2 })
      fireFrame()
      gate.flushPass(() => gate.write("b", { y: 3 }))
      expect(events).toEqual(["commit a", "commit b"])

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("a pass doesn't switch an element that hasn't had its first frame: the next frame flush does", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const events: Array<string> = []
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      gate.register("a", sinkOf(() => void events.push("commit"), { beforeFirstCommit: () => void events.push("switch") }))

      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(events).toEqual(["commit"])
      gate.write("a", { x: 2 })
      fireFrame()
      expect(events).toEqual(["commit", "switch", "commit"])

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("same-key writes within a frame coalesce (last wins); different keys merge", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      gate.register("a", sinkOf((p) => (received = p)))

      gate.write("a", { x: 1 })
      gate.write("a", { x: 2 }) // same key — last value wins
      gate.write("a", { y: 9 }) // different key — merges in
      // Still one frame for all three writes.
      expect(frames.request).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(received).toEqual({ x: 2, y: 9 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("gated frames: a flush with nothing newly written requests no new frame; a fresh write requests one", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      gate.register("a", sinkOf((p) => (received = p)))

      gate.write("a", { x: 1 })
      expect(frames.request).toHaveBeenCalledTimes(1)

      fireFrame()
      expect(received).toEqual({ x: 1 })
      // GATED: flush does NOT auto-reschedule — idle accumulator => no new frame.
      expect(frames.request).toHaveBeenCalledTimes(1)
      expect(frames.pending.size).toBe(0)

      // A fresh write requests one.
      gate.write("a", { x: 5 })
      expect(frames.request).toHaveBeenCalledTimes(2)
      fireFrame()
      expect(received).toEqual({ x: 5 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("unregister removes the element and a subsequent write is a no-op", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let received: Renderer.Patch | undefined
      const unregister = gate.register("a", sinkOf((p) => (received = p)))

      unregister()
      gate.write("a", { x: 1 })
      // No-op: nothing registered under "a", so no frame is requested.
      expect(frames.request).not.toHaveBeenCalled()

      fireFrame()
      expect(received).toBeUndefined()

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("dispose cancels a pending frame", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      gate.register("a", sinkOf(() => {}))
      gate.write("a", { x: 1 })
      expect(frames.request).toHaveBeenCalledTimes(1)
      expect(frames.pending.size).toBe(1)

      gate.dispose()
      expect(frames.cancel).toHaveBeenCalledTimes(1)
      expect(frames.pending.size).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })

  it("on pushable frames, a Tier 2 Stream on the ticks (not on the loop) still paints at the next frame: the source's request", async () => {
    // One `advance` is one Refresh frame: the frames requested so far, then the Clock's tick
    // (ADR-0031, decision 6). A write the Frame loop's tick doesn't make takes the gate's own
    // request, so it paints in the next frame, as every write did before ADR-0033.
    const clock = Effect.runSync(TestClock.pushable())
    const runtime = ManagedRuntime.make(FrameLoop.layer.pipe(Layer.provideMerge(Layer.mergeAll(HEARD, clock.layer, AtomRegistry.layer))))
    const events: Array<string> = []
    const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
    gate.register("a", sinkOf((p) => void events.push(`flush ${String(p.x)}`)))
    const { ticks } = runtime.runSync(Effect.service(Clock.Clock))
    let n = 0
    const fiber = runtime.runFork(
      Stream.runForEach(ticks, () =>
        Effect.sync(() => {
          n++
          events.push(`tick ${n}`)
          gate.write("a", { x: n })
        })),
    )
    await runtime.runPromise(clock.advance())
    expect(events).toEqual(["tick 1"])
    await runtime.runPromise(clock.advance())
    await runtime.runPromise(clock.advance())
    expect(events).toEqual(["tick 1", "flush 1", "tick 2", "flush 2", "tick 3"])
    await runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await runtime.dispose()
  })
})

/**
 * A runtime whose Frame loop ticks on `TestClock.pushable()` (one `advance`, one tick) and whose
 * gate requests its frames from the hand-driven source (`frames`), with `reports` collecting what
 * the Environment's ErrorReporters get.
 */
const onTicks = () => {
  const clock = Effect.runSync(TestClock.pushable())
  const reports: Array<string> = []
  const runtime = ManagedRuntime.make(
    withFrames(
      FrameLoop.layer.pipe(
        Layer.provideMerge(Layer.merge(HEARD, clock.layer)),
        Layer.provideMerge(ErrorReporter.layer([ErrorReporter.make(({ error }) => void reports.push(error.message))])),
      ),
    ),
  )
  const advance = (): Promise<void> => runtime.runPromise(clock.advance())
  /** A run on the loop that never settles (or settles at its `settleAt`-th step), its sink `onStep(n)`. */
  const run = (onStep: (n: number) => void, settleAt = Infinity) =>
    runtime.runFork(
      Machine.make({
        settles: true,
        span: { name: "test.gate", attributes: {} },
        start: () => {
          let n = 0
          return () => {
            n++
            return { value: n, done: n >= settleAt }
          }
        },
      }).pipe(
        Machine.run((frame) => {
          onStep(frame.value)
          return undefined
        }),
      ),
    )
  return { runtime, advance, run, reports }
}

describe("makeFlushGate — at the end of the Frame loop's tick (ADR-0033)", () => {
  it("G1: what a tick writes is applied at the end of that tick, in the same frame, and the frame it requested is withdrawn", async () => {
    const t = onTicks()
    const events: Array<string> = []
    const gate = internalGate.makeFlushGate(t.runtime, NO_BATCH)
    gate.register("a", sinkOf((p) => void events.push(`flush ${String(p.x)}`)))
    const fiber = t.run((n) => {
      events.push(`tick ${n}`)
      gate.write("a", { x: n })
    })
    await t.advance()
    expect(events).toEqual(["tick 1", "flush 1"])
    await t.advance()
    expect(events).toEqual(["tick 1", "flush 1", "tick 2", "flush 2"])
    // Each tick's first write requested a frame, and the end of the tick withdrew it.
    expect(frames.request).toHaveBeenCalledTimes(2)
    expect(frames.cancel).toHaveBeenCalledTimes(2)
    expect(frames.pending.size).toBe(0)
    await t.runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await t.runtime.dispose()
  })

  it("G2: the tick that settles the last run, and ends the loop's burst, flushes its settled Frame", async () => {
    const t = onTicks()
    const applied: Array<unknown> = []
    const gate = internalGate.makeFlushGate(t.runtime, NO_BATCH)
    gate.register("a", sinkOf((p) => void applied.push(p.x)))
    const fiber = t.run((n) => gate.write("a", { x: n }), 2)
    await t.advance()
    await t.advance()
    expect(applied).toEqual([1, 2])
    expect(fiber.pollUnsafe()).toBeDefined()
    expect(frames.pending.size).toBe(0)
    gate.dispose()
    await t.runtime.dispose()
  })

  it("G3: a write made before the tick, outside it, is flushed with the tick's, and its frame withdrawn", async () => {
    const t = onTicks()
    const patches: Array<Renderer.Patch> = []
    const gate = internalGate.makeFlushGate(t.runtime, NO_BATCH)
    gate.register("a", sinkOf((p) => void patches.push(p)))
    gate.register("b", sinkOf((p) => void patches.push(p)))
    const fiber = t.run((n) => gate.write("a", { x: n }))
    gate.write("b", { y: 1 }) // a drag's move, from its input task, before the frame
    expect(frames.pending.size).toBe(1)
    await t.advance()
    expect(patches).toEqual([{ x: 1 }, { y: 1 }])
    expect(frames.pending.size).toBe(0)
    await t.runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await t.runtime.dispose()
  })

  it("G4: a write from an effect a sink's hook ran, for an element the flush has passed, waits for the next frame, which the source fires", async () => {
    const t = onTicks()
    const applied: Array<string> = []
    let effectWrote = false
    const gate = internalGate.makeFlushGate(t.runtime, NO_BATCH)
    gate.register("b", sinkOf((p) => void applied.push(`b ${String(p.y)}`)))
    gate.register(
      "a",
      sinkOf((p) => void applied.push(`a ${String(p.x)}`), {
        // An effect the hook ran writes once, as a Solid effect a signal set runs would.
        onHeld: () => {
          if (effectWrote) return
          effectWrote = true
          gate.write("b", { y: 1 })
        },
      }),
    )
    const fiber = t.run((n) => gate.write("a", { x: n }), 1)
    await t.advance()
    expect(applied).toEqual(["a 1"])
    expect(frames.pending.size).toBe(1)
    fireFrame()
    expect(applied).toEqual(["a 1", "b 1"])
    await t.runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await t.runtime.dispose()
  })

  it("G5: a tick that writes nothing runs no batch, even with a switch waiting", async () => {
    const t = onTicks()
    let batches = 0
    const gate = internalGate.makeFlushGate(t.runtime, {
      batch: (apply) => {
        batches++
        apply()
      },
    })
    gate.register("a", sinkOf(() => {}, { beforeFirstCommit: () => {} }))
    const fiber = t.run(() => {})
    await t.advance()
    await t.advance()
    expect(batches).toBe(0)
    await t.runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await t.runtime.dispose()
  })

  it("G6: dispose takes the gate's hook off the loop: a later tick flushes nothing", async () => {
    const t = onTicks()
    const applied: Array<unknown> = []
    const gate = internalGate.makeFlushGate(t.runtime, NO_BATCH)
    gate.dispose()
    gate.register("a", sinkOf((p) => void applied.push(p.x)))
    const fiber = t.run((n) => gate.write("a", { x: n }))
    await t.advance()
    expect(applied).toEqual([])
    expect(frames.pending.size).toBe(1) // only the source's request is left
    await t.runtime.runPromise(Fiber.interrupt(fiber))
    await t.runtime.dispose()
  })

  it("G7: a flush that throws is reported, and the loop and the gate go on", async () => {
    const t = onTicks()
    const applied: Array<unknown> = []
    const ticks: Array<number> = []
    let throws = true
    const gate = internalGate.makeFlushGate(t.runtime, NO_BATCH)
    gate.register(
      "a",
      sinkOf((p) => {
        if (throws) {
          throws = false
          throw new Error("a commit threw")
        }
        applied.push(p.x)
      }),
    )
    const fiber = t.run((n) => {
      ticks.push(n)
      gate.write("a", { x: n })
    })
    await t.advance()
    expect(t.reports).toEqual(["a commit threw"])
    await t.advance()
    expect(ticks).toEqual([1, 2])
    expect(applied).toEqual([2])
    expect(fiber.pollUnsafe()).toBeUndefined() // the run is still on the loop
    await t.runtime.runPromise(Fiber.interrupt(fiber))
    gate.dispose()
    await t.runtime.dispose()
  })
})

describe("makeFlushGate — flushPass (the Measure pass flush; ADR-0018, ADR-0006 amendment)", () => {
  it("runs the pass synchronously and applies exactly what it wrote before returning, with no frame fired", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      const order: Array<string> = []
      let received: Renderer.Patch | undefined
      gate.register("a", sinkOf((p) => ((received = p), order.push("apply"))))

      gate.flushPass(() => {
        order.push("pass")
        gate.write("a", { x: 1 }) // a FLIP seed written by the Measure pass
      })
      expect(order).toEqual(["pass", "apply"])
      expect(received).toEqual({ x: 1 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("leaves an entry the pass did not write for the next frame, even if it was already dirty", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let a: Renderer.Patch | undefined
      let b: Renderer.Patch | undefined
      gate.register("a", sinkOf((p) => (a = p)))
      gate.register("b", sinkOf((p) => (b = p)))

      gate.write("b", { y: 2 }) // e.g. another animation's value from this frame's Clock tick
      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(a).toEqual({ x: 1 })
      expect(b).toBeUndefined() // keeps ADR-0006's one-frame latency

      fireFrame()
      expect(b).toEqual({ y: 2 })

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("the next frame does not re-apply an entry the pass flushed unless it was written again", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let applied = 0
      gate.register("a", sinkOf(() => applied++))

      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(applied).toBe(1)
      fireFrame()
      expect(applied).toBe(1)

      gate.write("a", { x: 2 })
      fireFrame()
      expect(applied).toBe(2)

      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("has no measure read-queue any more", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      expect("scheduleMeasure" in gate).toBe(false)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("after dispose, a pass applies nothing and requests no frame", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      let applied = 0
      gate.register("a", sinkOf(() => applied++))
      gate.dispose()

      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(applied).toBe(0)
      expect(frames.pending.size).toBe(0)
    } finally {
      void runtime.dispose()
    }
  })
})

// The raise's reset (ADR-0016, *Amendment (Reorder)*): the engine carries a dragged
// node's raise inside `@projection`, and the renderer emits `z-index` only while it's
// there. The gate removes a key its previous patch had and this one doesn't, restoring the
// element's own inline value (on a real element: `gate.browser.test.ts`, GK1–GK2). DOM's
// `project` builds anywhere (ADR-0021, decision 7), so these run on it (`HEARD_DOM`).
describe("makeFlushGate — a key that drops out of a patch", () => {
  const IDENTITY: Projection.Delta = {
    x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
    y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  }
  const raised = { [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 }, raise: 1 } }
  const lowered = { [Projection.KEY]: { delta: IDENTITY, treeScale: { x: 1, y: 1 } } }

  it("GK3: the patch carries z-index while raised; once lowered, the gate restores it, then commits a patch without it", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD_DOM, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      const patches: Array<Renderer.Patch> = []
      gate.register("a", sinkOf((p) => patches.push(p)))
      gate.write("a", raised)
      fireFrame()
      gate.write("a", lowered)
      fireFrame()
      expect(patches[0]?.["z-index"]).toBe(1)
      // The node-tier target has no inline style, so its own value is "".
      expect(patches[1]).toEqual({ "z-index": "" })
      expect(patches[2] !== undefined && "z-index" in patches[2]).toBe(false)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

describe("makeFlushGate — release (#47, ADR-0022): a key handed back to the element's own style", () => {
  it("GR1: a released key is restored, and the next patch lacks it and keeps the rest", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD_DOM, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      const patches: Array<Renderer.Patch> = []
      gate.register("a", sinkOf((p) => patches.push(p)))
      gate.write("a", { opacity: 0.5, scale: 1.2 })
      fireFrame()
      gate.release("a", ["opacity"])
      fireFrame()
      expect(patches[1]).toEqual({ opacity: "" })
      expect(patches[2]).toEqual({ transform: "scale(1.2)" })
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GR4: releasing a key the entry doesn't hold, or an unknown id, requests nothing", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD_DOM, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      gate.register("a", sinkOf(() => {}))
      gate.write("a", { opacity: 0.5 })
      fireFrame()
      const calls = frames.request.mock.calls.length
      gate.release("a", ["scale"])
      gate.release("nobody", ["opacity"])
      expect(frames.request.mock.calls.length).toBe(calls)
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

// The keys the gate holds on an element (ADR-0034): a binding whose `style` prop reaches the
// element leaves them out of it, so the sink hears them change around the commits.
describe("makeFlushGate — the keys held on an element (ADR-0034)", () => {
  it("GH1: the sink hears the keys held before the commit that first writes one, and not on a frame that keeps them", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      const events: Array<string> = []
      gate.register(
        "a",
        sinkOf((p) => void events.push(`commit ${JSON.stringify(p)}`), {
          onHeld: (keys) => void events.push(`held ${keys.join(",")}`),
        }),
      )
      gate.write("a", { x: 1 })
      fireFrame()
      gate.write("a", { x: 2 })
      fireFrame()
      gate.write("a", { y: 3 })
      fireFrame()
      expect(events).toEqual([
        "held x",
        'commit {"x":1}',
        'commit {"x":2}',
        "held x,y",
        'commit {"x":2,"y":3}',
      ])
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GH2: a key that drops out is restored first, then the sink hears the keys left, then the patch is committed", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      const events: Array<string> = []
      gate.register(
        "a",
        sinkOf((p) => void events.push(`commit ${JSON.stringify(p)}`), {
          onHeld: (keys) => void events.push(`held ${keys.join(",")}`),
        }),
      )
      gate.write("a", { x: 1, y: 2 })
      fireFrame()
      events.length = 0
      gate.release("a", ["x"], { x: "7" })
      fireFrame()
      expect(events).toEqual(['commit {"x":"7"}', "held y", 'commit {"y":2}'])
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })

  it("GH3: a Measure pass's commits are heard too, so a key it adds is held before it's written", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
      const events: Array<string> = []
      gate.register(
        "a",
        sinkOf(() => void events.push("commit"), { onHeld: (keys) => void events.push(`held ${keys.join(",")}`) }),
      )
      gate.flushPass(() => gate.write("a", { x: 1 }))
      expect(events).toEqual(["held x", "commit"])
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

describe("makeFlushGate — the keys held, heard in the binding's batch (ADR-0034, *Amendment (#209)*)", () => {
  it("GH4: every element's keys held are heard in one batch, after the restores and before any commit", () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    try {
      const events: Array<string> = []
      // A binding that applies its updates at the end of its batch, as Solid 2's flush does.
      const gate = internalGate.makeFlushGate(runtime, {
        batch: (apply) => {
          events.push("batch")
          apply()
          events.push("end")
        },
      })
      for (const id of ["a", "b"]) {
        gate.register(
          id,
          sinkOf((p) => void events.push(`commit ${id} ${JSON.stringify(p)}`), {
            onHeld: (keys) => void events.push(`held ${id} ${keys.join(",")}`),
          }),
        )
      }
      gate.write("a", { x: 1 })
      gate.write("b", { y: 2 })
      fireFrame()
      expect(events).toEqual(["batch", "held a x", "held b y", "end", 'commit a {"x":1}', 'commit b {"y":2}'])
      events.length = 0
      // A frame that keeps every key runs no batch.
      gate.write("a", { x: 3 })
      fireFrame()
      expect(events).toEqual(['commit a {"x":3}'])
      gate.dispose()
    } finally {
      void runtime.dispose()
    }
  })
})

describe("the gate's live outputs, valueOf (#130, ADR-0043)", () => {
  /** A gate on a still loop, and the registry its outputs live in. */
  const harness = () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
    const registry = runtime.runSync(AtomRegistry.AtomRegistry)
    const end = (): void => {
      gate.dispose()
      void runtime.dispose()
    }
    return { runtime, gate, registry, end }
  }

  it("GV1: undefined before the key's first write; then the value written, before projection, as the write lands", () => {
    const { gate, registry, end } = harness()
    gate.register("a", sinkOf(() => {}))
    const x = gate.valueOf("a", "x")
    expect(registry.get(x)).toBeUndefined()
    gate.write("a", { x: 12 })
    expect(registry.get(x), "at the write, before the commit").toBe(12)
    fireFrame()
    expect(registry.get(x)).toBe(12)
    gate.write("a", { x: 30, opacity: 0.5 })
    expect(registry.get(x)).toBe(30)
    end()
  })

  it("GV7: a value derived from an output and written as it changes commits in the same flush", () => {
    const { gate, registry, end } = harness()
    const patches: Array<Renderer.Patch> = []
    gate.register("a", sinkOf((p) => void patches.push(p)))
    // opacity follows x, written by the output's subscriber, as a binding's follower would.
    registry.subscribe(gate.valueOf("a", "x"), (x) => gate.write("a", { opacity: 1 - (x as number) / 100 }))
    gate.write("a", { x: 50 })
    fireFrame()
    expect(patches).toEqual([{ x: 50, opacity: 0.5 }])
    end()
  })

  it("GV2: a subscriber hears each change once, and nothing when a commit leaves the key as it was (the gate skips it; the registry would too)", () => {
    const { gate, registry, end } = harness()
    gate.register("a", sinkOf(() => {}))
    const heard: Array<unknown> = []
    registry.subscribe(gate.valueOf("a", "x"), (v) => void heard.push(v))
    gate.write("a", { x: 1 })
    fireFrame()
    gate.write("a", { opacity: 0.2 })
    fireFrame()
    gate.write("a", { x: 1 })
    fireFrame()
    gate.write("a", { x: 2 })
    fireFrame()
    expect(heard).toEqual([1, 2])
    end()
  })

  it("GV3: a released key's output is undefined from the release", () => {
    const { gate, registry, end } = harness()
    gate.register("a", sinkOf(() => {}))
    const x = gate.valueOf("a", "x")
    gate.write("a", { x: 5, opacity: 1 })
    fireFrame()
    gate.release("a", ["x"])
    expect(registry.get(x)).toBeUndefined()
    end()
  })

  it("GV4: asked before its element registers, it's picked up at the register; the same Atom for an id and a key", () => {
    const { gate, registry, end } = harness()
    const x = gate.valueOf("a", "x")
    expect(gate.valueOf("a", "x")).toBe(x)
    gate.register("a", sinkOf(() => {}))
    gate.write("a", { x: 7 })
    fireFrame()
    expect(registry.get(x)).toBe(7)
    end()
  })

  it("GV5: an element's unregister sets its outputs to undefined", () => {
    const { gate, registry, end } = harness()
    const unregister = gate.register("a", sinkOf(() => {}))
    const x = gate.valueOf("a", "x")
    gate.write("a", { x: 3 })
    fireFrame()
    unregister()
    expect(registry.get(x)).toBeUndefined()
    end()
  })

  it("GV6: an element with no output asked for commits as before", () => {
    const { gate, end } = harness()
    let received: Renderer.Patch | undefined
    gate.register("a", sinkOf((p) => (received = p)))
    gate.write("a", { x: 4 })
    fireFrame()
    expect(received).toEqual({ x: 4 })
    end()
  })
})

describe("the gate's commit hook, onCommit (#233, ADR-0043 Amendment (#233, #234))", () => {
  /** A gate on a still loop. */
  const harness = () => {
    const runtime = ManagedRuntime.make(withFrames(Layer.merge(HEARD, stillLoop)))
    const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
    const end = (): void => {
      gate.dispose()
      void runtime.dispose()
    }
    return { gate, end }
  }

  it("GC1: told once per flush that commits the element, after every commit of it, with its values before projection", () => {
    const { gate, end } = harness()
    const events: Array<string> = []
    gate.register("a", sinkOf(() => void events.push("commit a"), { onCommit: (v) => void events.push(`told a ${JSON.stringify(v)}`) }))
    gate.register("b", sinkOf(() => void events.push("commit b")))
    gate.write("a", { x: 10 })
    gate.write("b", { x: 1 })
    gate.write("a", { opacity: 0.5 })
    fireFrame()
    expect(events).toEqual(["commit a", "commit b", 'told a {"x":10,"opacity":0.5}'])
    end()
  })

  it("GC2: a flush that doesn't commit the element doesn't tell it", () => {
    const { gate, end } = harness()
    let told = 0
    gate.register("a", sinkOf(() => {}, { onCommit: () => void told++ }))
    gate.register("b", sinkOf(() => {}))
    gate.write("a", { x: 1 })
    fireFrame()
    gate.write("b", { x: 2 })
    fireFrame()
    expect(told).toBe(1)
    end()
  })

  it("GC3: a Measure pass's commit is told at the frame flush after it, once with that frame's own", () => {
    const { gate, end } = harness()
    const told: Array<unknown> = []
    gate.register("a", sinkOf(() => {}, { onCommit: (v) => void told.push({ ...v }) }))
    gate.flushPass(() => gate.write("a", { x: 3 }))
    expect(told, "not inside the pass").toEqual([])
    gate.write("a", { y: 4 })
    fireFrame()
    expect(told).toEqual([{ x: 3, y: 4 }])
    // A pass with no write after it still gets its frame flush.
    gate.flushPass(() => gate.write("a", { x: 5 }))
    fireFrame()
    expect(told).toEqual([{ x: 3, y: 4 }, { x: 5, y: 4 }])
    end()
  })

  it("GC4: one object per element, reused, without a key the gate let go of", () => {
    const { gate, end } = harness()
    const seen: Array<Readonly<Record<string, unknown>>> = []
    const snapshots: Array<unknown> = []
    gate.register("a", sinkOf(() => {}, { onCommit: (v) => {
      seen.push(v)
      snapshots.push({ ...v })
    } }))
    gate.write("a", { x: 1, opacity: 1 })
    fireFrame()
    gate.release("a", ["opacity"])
    gate.write("a", { x: 2 })
    fireFrame()
    expect(seen[0]).toBe(seen[1])
    expect(snapshots).toEqual([{ x: 1, opacity: 1 }, { x: 2 }])
    end()
  })

  it("GC5: a throw is reported, and the other elements are still told", async () => {
    const reports: Array<string> = []
    const runtime = ManagedRuntime.make(
      withFrames(Layer.merge(HEARD, stillLoop).pipe(Layer.provideMerge(ErrorReporter.layer([ErrorReporter.make(({ error }) => void reports.push(error.message))])))),
    )
    const gate = internalGate.makeFlushGate(runtime, NO_BATCH)
    const end = (): void => {
      gate.dispose()
      void runtime.dispose()
    }
    const told: Array<string> = []
    gate.register("a", sinkOf(() => {}, { onCommit: () => {
      throw new Error("boom")
    } }))
    gate.register("b", sinkOf(() => {}, { onCommit: () => void told.push("b") }))
    gate.write("a", { x: 1 })
    gate.write("b", { x: 1 })
    fireFrame()
    expect(told).toEqual(["b"])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reports).toEqual(["boom"])
    end()
  })
})
