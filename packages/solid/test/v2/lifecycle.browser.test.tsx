// A ward's lifecycle module on Solid 2 (#257, ADR-0046), driven through its spine hooks by hand: what
// the spine's timing makes hard to reach through a ward.
//
// - LF1: a settle told for a Retarget that's no longer the one in flight (a later one started before
//   the gate's flush told it) lands nothing; the one in flight does.
// - LF2: nothing Solid until `settled` is read: a landing before the first read is what that read
//   returns, built then, with the gesture layers on when its Retarget started (not at its landing).
// - LF3: a landing's definition is the variant name only when the variant changed since the Retarget
//   before it; a gesture's Retarget over the same variant hands over its values.
import type { Resolution } from "../../src/spine.ts"
import { makeLifecycle, type WardGestures } from "../../src/unstable/v2/lifecycle.ts"
import { createRoot, getOwner } from "solid-js"
import { describe, expect, it } from "vitest"

const NONE: WardGestures = { hover: false, tap: false, drag: false }
const CONFIG = {}

const resolution = (resolved: Record<string, number>, variant?: string): Resolution => ({ resolved, base: resolved, dragging: false, variant })

/** A lifecycle in a root of its own, with the gestures `layers()` gives at each start. */
const lifecycleIn = (layers: () => WardGestures = () => NONE) => {
  let dispose!: () => void
  const lifecycle = createRoot((d) => {
    dispose = d
    return makeLifecycle(getOwner(), layers)
  })
  return { lifecycle, dispose }
}

describe("a ward's lifecycle (#257)", () => {
  it("LF1: a settle for a Retarget no longer in flight lands nothing; the one in flight does", async () => {
    const { lifecycle, dispose } = lifecycleIn()
    const { hooks } = lifecycle
    const a = resolution({ opacity: 1 })
    const b = resolution({ opacity: 0.5 })
    const landed = lifecycle.next("settled")
    hooks.started(a, undefined, CONFIG)
    hooks.started(b, undefined, CONFIG)
    hooks.settled(a, undefined, CONFIG)
    expect(lifecycle.settled(), "a's settle came after b started").toBeUndefined()
    hooks.settled(b, undefined, CONFIG)
    expect((await landed).target).toEqual({ opacity: 0.5 })
    dispose()
  })

  it("LF2: a landing before the first read is what that read returns, with the layers on at its start", () => {
    let hovering = true
    const { lifecycle, dispose } = lifecycleIn(() => ({ hover: hovering, tap: false, drag: false }))
    const a = resolution({ opacity: 1 })
    lifecycle.hooks.started(a, undefined, CONFIG)
    hovering = false
    lifecycle.hooks.settled(a, undefined, CONFIG)
    createRoot((d) => {
      expect(lifecycle.settled()).toEqual({ definition: { opacity: 1 }, target: { opacity: 1 }, gestures: { hover: true, tap: false, drag: false } })
      d()
    })
    dispose()
  })

  it("LF3: the variant name only when the variant changed; a gesture's Retarget over it hands over values", async () => {
    const { lifecycle, dispose } = lifecycleIn()
    const { hooks } = lifecycle
    const rest = resolution({ opacity: 0.2 }, "rest")
    const first = lifecycle.next("settled")
    hooks.started(rest, undefined, CONFIG)
    hooks.settled(rest, undefined, CONFIG)
    expect((await first).definition).toBe("rest")
    const hovered: Resolution = { resolved: { opacity: 1 }, base: { opacity: 0.2 }, dragging: false, variant: "rest" }
    const second = lifecycle.next("settled")
    hooks.started(hovered, "rest", CONFIG)
    hooks.settled(hovered, "rest", CONFIG)
    expect((await second).definition).toEqual({ opacity: 1 })
    dispose()
  })
})
