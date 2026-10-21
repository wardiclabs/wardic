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
import { type GestureState, Lifecycle } from "../../src/unstable/v2/lifecycle.ts"
import { createRoot, getOwner } from "solid-js"
import { describe, expect, it } from "vitest"

const NONE: GestureState = { hovered: false, pressed: false, dragging: false }

const resolution = (resolved: Record<string, number>, variant?: string): Resolution => ({ resolved, base: resolved, dragging: false, variant })

/** A lifecycle in a root of its own, with the gesture state `layers()` gives at each start; disposed with it. */
const lifecycleIn = (layers: () => GestureState = () => NONE) => {
  let disposeRoot!: () => void
  const lifecycle = createRoot((d) => {
    disposeRoot = d
    return new Lifecycle(getOwner(), layers, () => false)
  })
  const dispose = (): void => {
    lifecycle.dispose()
    disposeRoot()
  }
  return { lifecycle, dispose, hooks: lifecycle }
}

describe("a ward's lifecycle (#257)", () => {
  it("LF1: a settle for a Retarget no longer in flight lands nothing; the one in flight does", async () => {
    const { lifecycle, dispose, hooks } = lifecycleIn()
        const a = resolution({ opacity: 1 })
    const b = resolution({ opacity: 0.5 })
    const landed = lifecycle.wait("settled")
    hooks.started(a)
    hooks.started(b)
    hooks.settled(a, undefined)
    expect(lifecycle.read(), "a's settle came after b started").toBeUndefined()
    hooks.settled(b, undefined)
    expect((await landed).target).toEqual({ opacity: 0.5 })
    dispose()
  })

  it("LF2: a landing before the first read is what that read returns, with the layers on at its start", () => {
    let hovering = true
    const { lifecycle, dispose } = lifecycleIn(() => ({ hovered: hovering, pressed: false, dragging: false }))
    const a = resolution({ opacity: 1 })
    lifecycle.started(a)
    hovering = false
    lifecycle.settled(a, undefined)
    createRoot((d) => {
      expect(lifecycle.read()).toEqual({ definition: { opacity: 1 }, target: { opacity: 1 }, gestures: { hover: true, tap: false, drag: false } })
      d()
    })
    dispose()
  })

  it("LF3: the variant name only when the variant changed; a gesture's Retarget over it hands over values", async () => {
    const { lifecycle, dispose, hooks } = lifecycleIn()
        const rest = resolution({ opacity: 0.2 }, "rest")
    const first = lifecycle.wait("settled")
    hooks.started(rest)
    hooks.settled(rest, undefined)
    expect((await first).definition).toBe("rest")
    const hovered: Resolution = { resolved: { opacity: 1 }, base: { opacity: 0.2 }, dragging: false, variant: "rest" }
    const second = lifecycle.wait("settled")
    hooks.started(hovered)
    hooks.settled(hovered, "rest")
    expect((await second).definition).toEqual({ opacity: 1 })
    dispose()
  })
})
