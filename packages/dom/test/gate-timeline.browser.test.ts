// The gate and a key's Timeline value (#240): the binding sets one while the key shows its Live value,
// and the gate starts or cancels its animation at the flush that commits the element, before the
// commit, going on writing the key inline under it. On `DomLive`'s Renderer and a hand-driven Refresh
// frame source (`gate-harness.ts`); the Timeline values are real, on a scroll box's progress.
//
// - GT1: set, it starts at the next flush, with no write needed, and the key is still written inline.
// - GT2: cleared, it's cancelled at the next flush, not before, and that flush's commit draws the key.
// - GT3: on a transform key, another transform key off its identity cancels it at that flush, the
//   transform drawn whole inline; back at its identity, it starts again.
// - GT4: an element the projection draws runs none: its Crossfade's opacity is the projection's.
// - GT5: unregistered, or replaced by another for the key, it's cancelled; a released key's too.
import * as LiveValue from "@wardic/core/LiveValue"
import * as Projection from "@wardic/core/Projection"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import { AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import * as DomInterpolators from "../src/DomInterpolators.ts"
import * as DomScrollSource from "../src/DomScrollSource.ts"
import * as TimelineValue from "../src/TimelineValue.ts"
import { fireFrame, NO_BATCH, resetFrames, withFrames } from "./gate-harness.ts"
import * as internalGate from "../src/internal/gate.ts"

/** The scroll Feature's services, on a runtime of their own. */
const scrollServices = ManagedRuntime.make(Layer.provideMerge(Layer.merge(DomScrollSource.layer, DomInterpolators.layer), AtomRegistry.layer))

const IDENTITY: Projection.Delta = {
  x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
}

let gateRuntime: ManagedRuntime.ManagedRuntime<unknown, unknown>
let gate: internalGate.FlushGate
let scope: Scope.Closeable
let host: HTMLElement
let el: HTMLElement
let box: HTMLElement

beforeEach(() => {
  resetFrames()
  gateRuntime = ManagedRuntime.make(withFrames(DomLive)) as ManagedRuntime.ManagedRuntime<unknown, unknown>
  gate = internalGate.makeFlushGate(gateRuntime as never, NO_BATCH)
  scope = Effect.runSync(Scope.make())
  host = document.createElement("div")
  host.innerHTML = `<div data-el style="width: 100px; height: 10px"></div>
    <div data-box style="height: 100px; overflow: auto"><div style="height: 1000px"></div></div>`
  document.body.append(host)
  el = host.querySelector("[data-el]") as HTMLElement
  box = host.querySelector("[data-box]") as HTMLElement
  gate.register("el", { target: el })
})

afterEach(() => {
  gate.dispose()
  Effect.runSync(Scope.close(scope, Exit.void))
  host.remove()
  void gateRuntime.dispose()
})

/** A Timeline value for `key` on `el`, of `box`'s progress. */
const timelineOf = (key: string): TimelineValue.TimelineValue =>
  scrollServices.runSync(
    Effect.gen(function* () {
      const { scrollYProgress } = yield* LiveValue.scroll({ container: box }).pipe(Scope.provide(scope))
      return Option.getOrThrow(yield* TimelineValue.make(Option.getOrThrow(LiveValue.scrollDerivationOf(scrollYProgress)), el, key))
    }),
  )

describe("the gate and a key's Timeline value (#240)", () => {
  it("GT1: set, it starts at the next flush, with no write needed, and the key is still written inline", () => {
    gate.write("el", { opacity: 0.3 })
    fireFrame()
    gate.timeline("el", "opacity", timelineOf("opacity"))
    expect(el.getAnimations(), "not before the flush").toHaveLength(0)
    fireFrame()
    expect(el.getAnimations()).toHaveLength(1)
    gate.write("el", { opacity: 0.4 })
    fireFrame()
    expect(el.style.opacity, "written under it").toBe("0.4")
    expect(el.getAnimations(), "the one it started").toHaveLength(1)
  })

  it("GT2: cleared, it's cancelled at the next flush, not before, and that flush's commit draws the key", () => {
    gate.timeline("el", "opacity", timelineOf("opacity"))
    gate.write("el", { opacity: 0.3 })
    fireFrame()
    expect(el.getAnimations()).toHaveLength(1)
    // An Override entry takes the key: its first value is written in the flush that cancels it.
    gate.timeline("el", "opacity", undefined)
    gate.write("el", { opacity: 1 })
    expect(el.getAnimations(), "not before the flush").toHaveLength(1)
    fireFrame()
    expect(el.getAnimations()).toHaveLength(0)
    expect(el.style.opacity).toBe("1")
  })

  it("GT3: on a transform key, another transform key off its identity cancels it at that flush; back at its identity, it starts again", () => {
    gate.timeline("el", "scaleX", timelineOf("scaleX"))
    gate.write("el", { scaleX: 0.5, x: 0 })
    fireFrame()
    expect(el.getAnimations(), "x at its identity adds nothing").toHaveLength(1)
    gate.write("el", { x: 10 })
    fireFrame()
    expect(el.getAnimations()).toHaveLength(0)
    expect(el.style.transform, "the transform drawn whole").toBe("translateX(10px) scaleX(0.5)")
    gate.write("el", { x: 0 })
    fireFrame()
    expect(el.getAnimations()).toHaveLength(1)
  })

  it("GT4: an element the projection draws runs none", () => {
    gate.timeline("el", "opacity", timelineOf("opacity"))
    gate.write("el", { opacity: 0.3, [Projection.KEY]: IDENTITY })
    fireFrame()
    expect(el.getAnimations()).toHaveLength(0)
  })

  it("GT5: unregistered, replaced by another for the key, or its key released, it's cancelled", () => {
    const first = timelineOf("opacity")
    gate.timeline("el", "opacity", first)
    gate.write("el", { opacity: 0.3 })
    fireFrame()
    const [running] = el.getAnimations()
    gate.timeline("el", "opacity", timelineOf("opacity"))
    fireFrame()
    expect(el.getAnimations(), "one, the new one").toHaveLength(1)
    expect(el.getAnimations()[0], "the new one").not.toBe(running)
    gate.release("el", ["opacity"])
    fireFrame()
    expect(el.getAnimations(), "a released key's").toHaveLength(0)
    gate.timeline("el", "scaleX", timelineOf("scaleX"))
    gate.write("el", { scaleX: 0.5 })
    fireFrame()
    expect(el.getAnimations()).toHaveLength(1)
    const unregister = gate.register("el", { target: el })
    expect(el.getAnimations(), "re-registered under the id: the old entry's cancelled").toHaveLength(0)
    unregister()
  })
})
