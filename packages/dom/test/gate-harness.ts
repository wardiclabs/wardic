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
//
// The gate commits every patch onto its sink's target (ADR-0034). In the node tier the target is
// a `sinkOf` callback, and the Renderer is `HEARD` (an identity `project`, as `TestLive`'s) or
// `HEARD_DOM` (the DOM's `project`, which builds anywhere): its `commit` hands the patch to it.
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import * as Renderer from "@wardic/core/Renderer"
import { TestClock } from "@wardic/test"
import * as Layer from "effect/Layer"
import { vi } from "vitest"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as FlushGate from "@wardic/dom/FlushGate"

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
export const NO_BATCH: FlushGate.Options = { batch: (apply) => apply() }

/** A node-tier sink target: it hears each patch the gate commits onto it. */
interface HeardTarget {
  readonly heard: (patch: Renderer.Patch) => void
}

/** A sink whose target hears each committed patch, with the binding's hooks, if any. */
export const sinkOf = (heard: (patch: Renderer.Patch) => void, hooks: Omit<FlushGate.Sink, "target"> = {}): FlushGate.Sink => ({
  target: { heard } satisfies HeardTarget,
  ...hooks,
})

const hear = (target: unknown, patch: Renderer.Patch): void => (target as HeardTarget).heard(patch)

/** A Renderer whose `project` is identity and whose `commit` hands the patch to its target. */
export const HEARD: Layer.Layer<Renderer.Renderer> = Layer.succeed(Renderer.Renderer, { project: (values) => values, commit: hear })

/** The same, with the DOM's `project`. */
export const HEARD_DOM: Layer.Layer<Renderer.Renderer> = Layer.succeed(Renderer.Renderer, { project: DomRenderer.project, commit: hear })
