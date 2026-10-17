// The flush gate and the projection system as services built by Layers (#132, ADR-0041, decisions
// 2 and 3), on the real DomLive.
//
// - DS1: one runtime builds each once: the same gate and engine however often they're read, and
//   the engine writes through that gate (its node's element gets its projection).
// - DS2: closing the runtime's Scope ends the engine, then the gate: the engine's resize listener
//   goes before the gate's pending frame is cancelled, and nothing is written after.
// - DS3: `ProjectionSystem.make` over a binding's own sink ends with its own Scope.
// - DS4: `FlushGate.inert` does nothing, and `FlushGate.layerInert` provides it.
//
// The Reorder controller's scoped constructor (#132's PR 3):
// - DS5: `ReorderController.make` runs over its context: a move is spoken through the context's
//   Announcer, and a change of axis is logged through the context's Logger.
// - DS6: closing its Scope ends it: no Measure pass reports an axis after, and nothing is logged.
// - DS7: `ReorderController.inert` does nothing.
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Match from "effect/Match"
import * as References from "effect/References"
import * as Scope from "effect/Scope"
import * as Announcer from "@wardic/core/Announcer"
import type * as Reorder from "@wardic/core/Reorder"
import { DomLive } from "@wardic/dom"
import * as FlushGate from "@wardic/dom/FlushGate"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Option from "effect/Option"

const stages: Array<HTMLElement> = []
afterEach(() => {
  for (const s of stages.splice(0)) s.remove()
  vi.restoreAllMocks()
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()))
}

/** An element on the page. */
const box = (css: string): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText = css
  document.body.append(el)
  stages.push(el)
  return el
}

/** One runtime with the gate and the engine over DomLive, as a binding's provider builds it. */
const runtimeOf = () =>
  ManagedRuntime.make(
    ProjectionSystem.layer().pipe(Layer.provideMerge(FlushGate.layer({ batch: (apply) => apply() })), Layer.provideMerge(DomLive)),
  )

const SPRING = () => Option.some({ type: "tween" as const, duration: 0.2 })

describe("the gate and the projection system as services (#132)", () => {
  it("DS1: one runtime builds each once, and the engine writes through that gate", async () => {
    const runtime = runtimeOf()
    const gate = runtime.runSync(FlushGate.FlushGate)
    expect(runtime.runSync(FlushGate.FlushGate), "the same gate").toBe(gate)
    const engine = runtime.runSync(ProjectionSystem.ProjectionSystem)
    expect(runtime.runSync(ProjectionSystem.ProjectionSystem), "the same engine").toBe(engine)
    // The engine's writes reach the gate: a node that moves animates on its element.
    const write = vi.spyOn(gate, "write")
    const el = box("position:absolute;left:0;top:0;width:40px;height:40px")
    // As a binding does: the element registered with the gate, under the id the engine writes.
    gate.register("n", { target: el })
    const node = engine.register({ id: "n", element: el, transition: SPRING })
    await frames(2)
    el.style.left = "100px"
    node.notify()
    await frames(4)
    expect(write.mock.calls.some(([id]) => id === "n"), "the engine wrote node n through the gate").toBe(true)
    expect(el.style.transform, "the element got its projection").not.toBe("")
    await runtime.dispose()
  })

  it("DS2: closing the Scope ends the engine, then the gate; nothing is written after", async () => {
    const order: Array<string> = []
    const removeListener = window.removeEventListener.bind(window)
    vi.spyOn(window, "removeEventListener").mockImplementation((type: string, ...rest: Array<unknown>) => {
      if (type === "resize") order.push("engine: resize listener removed")
      return removeListener(type, ...(rest as [EventListenerOrEventListenerObject]))
    })
    const cancel = window.cancelAnimationFrame.bind(window)
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number) => {
      order.push("gate: frame cancelled")
      return cancel(handle)
    })
    const runtime = runtimeOf()
    const gate = runtime.runSync(FlushGate.FlushGate)
    const engine = runtime.runSync(ProjectionSystem.ProjectionSystem)
    const el = box("position:absolute;left:0;top:0;width:40px;height:40px")
    engine.register({ id: "n", element: el, transition: SPRING })
    const target = box("width:10px;height:10px")
    gate.register("w", { target })
    await frames(2)
    // A write outside a tick requests the gate's own frame: pending when the Scope closes.
    gate.write("w", { opacity: 0.5 })
    await runtime.dispose()
    expect(order[0], "the engine first").toBe("engine: resize listener removed")
    expect(order, "then the gate's pending frame").toContain("gate: frame cancelled")
    await frames(3)
    expect(target.style.opacity, "nothing written after").toBe("")
  })

  it("DS3: ProjectionSystem.make over a binding's own sink ends with its own Scope", async () => {
    const remove = vi.spyOn(window, "removeEventListener")
    const runtime = ManagedRuntime.make(DomLive)
    const sink = { write: () => {}, flushPass: (pass: () => void) => pass() }
    const scope = Scope.makeUnsafe()
    const engine = runtime.runSync(ProjectionSystem.make(sink).pipe(Scope.provide(scope)))
    engine.register({ id: "n", element: box("width:40px;height:40px"), transition: SPRING })
    await frames(2)
    expect(remove.mock.calls.filter(([type]) => type === "resize")).toHaveLength(0)
    runtime.runSync(Scope.close(scope, Exit.void))
    expect(remove.mock.calls.filter(([type]) => type === "resize"), "its resize listener goes with its Scope").toHaveLength(1)
    await runtime.dispose()
  })

  it("DS4: FlushGate.inert does nothing, and layerInert provides it", () => {
    const unregister = FlushGate.inert.register("x", { target: undefined })
    expect(() => {
      unregister()
      FlushGate.inert.write("x", { opacity: 1 })
      FlushGate.inert.flushPass(() => {})
      FlushGate.inert.release("x", ["opacity"])
    }).not.toThrow()
    const runtime = ManagedRuntime.make(FlushGate.layerInert)
    expect(runtime.runSync(FlushGate.FlushGate)).toBe(FlushGate.inert)
    void Effect.runPromise(runtime.disposeEffect)
  })

  it("DS5: ReorderController.make speaks through the context's Announcer and logs through its Logger", async () => {
    const group = await mountGroup()
    group.controller.move("a", 2)
    expect(group.order(), "the move reorders").toEqual(["b", "c", "a"])
    expect(group.said, "spoken through the context's Announcer").toHaveLength(1)
    group.row()
    await frames(3)
    expect(group.axes, "the pass detects the row").toEqual(["x"])
    expect(group.logs(), "the axis change logged through the context's Logger").toContain("wardic.reorder: axis")
    await group.dispose()
  })

  it("DS6: closing its Scope ends it: no pass reports an axis after, and nothing is logged", async () => {
    const group = await mountGroup()
    group.close()
    group.row()
    await frames(3)
    expect(group.axes, "no axis after its Scope closed").toEqual([])
    expect(group.logs(), "nothing logged after").toEqual([])
    await group.dispose()
  })

  it("DS7: ReorderController.inert does nothing", () => {
    const item = ReorderController.inert.item(undefined as never, Option.none)
    expect(() => {
      ReorderController.inert.attach(box("width:10px"))
      ReorderController.inert.move(undefined as never, 1)
      ReorderController.inert.resolve()
      ReorderController.inert.valuesChanged()
      item.register({} as ProjectionSystem.NodeHandle)()
      item.dispose()
    }).not.toThrow()
    expect(ReorderController.inert.axis()).toBe("y")
  })
})

/**
 * A column of three items under a Reorder controller built by its scoped constructor, over a
 * runtime with the gate, the engine and a Logger over DomLive, as a binding builds one, and a
 * recording Announcer.
 */
const mountGroup = async () => {
  const logs: Array<string> = []
  const logger = Logger.make(({ message }) => {
    const text = String(Match.value(message).pipe(Match.when(Array.isArray, (parts) => parts[0]), Match.orElse((one) => one)))
    if (text.startsWith("wardic.reorder:")) logs.push(text)
  })
  const runtime = ManagedRuntime.make(
    ProjectionSystem.layer().pipe(
      Layer.provideMerge(FlushGate.layer({ batch: (apply) => apply() })),
      Layer.provideMerge(Layer.mergeAll(DomLive, Logger.layer([logger]), Layer.succeed(References.MinimumLogLevel, "Debug"))),
    ),
  )
  const engine = runtime.runSync(ProjectionSystem.ProjectionSystem)
  const said: Array<string> = []
  const axes: Array<Reorder.Axis> = []
  let order: ReadonlyArray<string> = ["a", "b", "c"]
  const scope = Scope.makeUnsafe()
  const controller = runtime.runSync(
    ReorderController.make<string>({
      values: () => order,
      onReorder: (next) => {
        order = next
      },
      onAxis: (axis) => axes.push(axis),
    }).pipe(Effect.provideService(Announcer.Announcer, { announce: (message) => said.push(message) }), Scope.provide(scope)),
  )
  const container = box("display:flex;flex-direction:column;gap:10px;width:200px")
  controller.attach(container)
  for (const value of order) {
    const element = document.createElement("div")
    element.style.cssText = "flex:none;width:80px;height:40px"
    container.append(element)
    controller.item(value, () => Option.some(element)).register(engine.register({ id: value, element, transition: SPRING }))
  }
  await frames(3)
  // What the first pass detected (a column, "y", the default, reports nothing), and logged.
  axes.length = 0
  logs.length = 0
  return {
    controller,
    said,
    axes,
    order: () => order,
    logs: () => [...logs],
    /** Lay the items out as a row, and re-measure. */
    row: (): void => {
      container.style.flexDirection = "row"
      engine.notify()
    },
    close: (): void => runtime.runSync(Scope.close(scope, Exit.void)),
    dispose: (): Promise<void> => runtime.dispose(),
  }
}
