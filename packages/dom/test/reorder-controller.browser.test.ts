// The DOM's Reorder controller (ADR-0020): the framework-free half of `<Reorder>` that
// every DOM binding shares, checked against a fake ProjectionSink with Refresh frames
// fired by hand. Each item is a real projection node; its drag samples are built here,
// as the binding's drag track would deliver them, with the handle's drag driven alongside.
//
// The controller owns core's Reorder group, reads the group element's `direction` at
// each drag start, builds its Auto-scroll, routes each item's samples (start, moves
// with Auto-scroll, end; an unmount mid-gesture ends it), detects the axis after every
// Measure pass (not while the app sets one), and warns once when an item re-registers
// with the same value in one task (the signature of a list keyed by index). It logs
// its own `wardic.reorder:` events through the runtime, so a binding wires no logging.
import type * as Drag from "@wardic/core/Drag"
import * as Reorder from "@wardic/core/Reorder"
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type * as ReorderController from "@wardic/dom/ReorderController"
import * as internalReorder from "../src/internal/reorder.ts"
import { clearStages, el, endOfTask, type Engine, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)
afterEach(() => {
  unstubFrames()
  clearStages()
})

type Kind = "column" | "row" | "grid"
const CONTAINER: Record<Kind, string> = {
  column: "display:flex;flex-direction:column;gap:10px;width:200px",
  row: "display:flex;flex-direction:row;gap:10px",
  grid: "display:flex;flex-wrap:wrap;gap:10px;width:280px",
}
const ITEM: Record<Kind, string> = {
  column: "flex:none;width:200px;height:50px",
  row: "flex:none;width:80px;height:50px",
  grid: "flex:none;width:80px;height:50px",
}

interface Item {
  readonly element: HTMLElement
  readonly handle: ProjectionSystem.NodeHandle
  readonly driver: ReturnType<internalReorder.ReorderController<string>["item"]>
  readonly unregister: () => void
}

interface List {
  readonly c: internalReorder.ReorderController<string>
  readonly items: Map<string, Item>
  readonly container: HTMLElement
  readonly reorders: Array<ReadonlyArray<string>>
  readonly axes: Array<Reorder.Axis>
  /** The controller's `wardic.reorder:` logs so far, by event. */
  readonly logs: () => Array<Log>
}

interface Log {
  readonly event: string
  readonly annotations: Record<string, unknown>
}

const PREFIX = "wardic.reorder: "
const reorderLogs = (e: Engine) => (): Array<Log> =>
  e.logs.filter((l) => l.message.startsWith(PREFIX)).map((l) => ({ event: l.message.slice(PREFIX.length), annotations: l.annotations }))

const mountList = async (
  e: Engine,
  kind: Kind,
  o: { readonly n?: number; readonly parent?: HTMLElement; readonly options?: Partial<ReorderController.Options<string>> } = {},
): Promise<List> => {
  const values = Array.from({ length: o.n ?? (kind === "grid" ? 6 : 3) }, (_, i) => String.fromCharCode(97 + i))
  let order: ReadonlyArray<string> = values
  const reorders: Array<ReadonlyArray<string>> = []
  const axes: Array<Reorder.Axis> = []
  const container = el(o.parent ?? stage(), CONTAINER[kind])
  // The factory itself, over the harness's engine; `ReorderController.make`, its scoped
  // constructor, is services.browser.test.ts's (DS5-DS7).
  const c = internalReorder.makeReorderController<string>({ runtime: e.runtime, projection: e.system }, {
    values: () => order,
    onReorder: (next) => {
      reorders.push(next)
      order = next
    },
    onAxis: (axis) => axes.push(axis),
    ...o.options,
  })
  c.attach(container)
  const items = new Map<string, Item>()
  for (const v of values) {
    const element = el(container, ITEM[kind])
    const handle = e.system.register({ id: v, element, transition: () => ({ type: "spring" }) })
    const driver = c.item(v, () => element)
    items.set(v, { element, handle, driver, unregister: driver.register(handle) })
  }
  await endOfTask()
  fireFrame()
  return { c, items, container, reorders, axes, logs: reorderLogs(e) }
}

const centre = (element: HTMLElement) => {
  const r = element.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

const sample = (
  phase: Drag.Sample["phase"],
  at: { x: number; y: number },
  offset: { x: number; y: number },
  timeStamp: number,
  velocity: { x: number; y: number } = { x: 0, y: 0 },
): Drag.Sample => ({
  phase,
  point: { x: at.x + offset.x, y: at.y + offset.y },
  offset,
  delta: { x: 0, y: 0 },
  velocity,
  timeStamp,
})

/**
 * Start a drag of `item` (its handle and its driver) and move it by `dy` in `steps` moves 16 ms
 * apart, each sample carrying that steady speed, as `drag`'s would.
 */
const dragY = (item: Item, dy: number, steps: number): { readonly end: () => void } => {
  const at = centre(item.element)
  const speed = { x: 0, y: dy / steps / 0.016 }
  item.handle.dragStart()
  item.driver.onSample(sample("start", at, { x: 0, y: 0 }, 0))
  for (let k = 1; k <= steps; k++) {
    const offset = { x: 0, y: (dy * k) / steps }
    item.handle.dragMove(offset)
    item.driver.onSample(sample("move", at, offset, 16 * k, speed))
  }
  return {
    end: () => {
      item.driver.onSample(sample("end", at, { x: 0, y: dy }, 16 * (steps + 1)))
      item.handle.dragEnd()
    },
  }
}

describe("the Reorder controller (ADR-0020)", () => {
  it("RC1: after the first Measure pass it reports the detected axis: a column y, a row x, a wrapped grid xy", async () => {
    for (const [kind, axis] of [
      ["column", "y"],
      ["row", "x"],
      ["grid", "xy"],
    ] as const) {
      const e = makeEngine(makeSink().sink)
      const list = await mountList(e, kind)
      expect(list.axes, kind).toEqual([axis])
      expect(list.c.axis(), kind).toBe(axis)
      list.c.dispose()
      e.dispose()
      clearStages()
    }
  })

  it("RC2: a pass that changes the layout reports the new axis; a pass that doesn't reports nothing", async () => {
    const e = makeEngine(makeSink().sink)
    const list = await mountList(e, "column")
    list.container.style.flexDirection = "row"
    for (const item of list.items.values()) item.element.style.width = "80px"
    e.system.notify()
    await endOfTask()
    expect(list.axes).toEqual(["y", "x"])
    expect(list.logs().filter((l) => l.event === "axis").map((l) => l.annotations.axis)).toEqual(["y", "x"])
    e.system.notify()
    await endOfTask()
    expect(list.axes).toEqual(["y", "x"])
    list.c.dispose()
    e.dispose()
  })

  it("RC3: while the app sets the axis no pass detects one; resolve() after it's cleared detects at once", async () => {
    const e = makeEngine(makeSink().sink)
    let override: Reorder.Axis | undefined = "x"
    const list = await mountList(e, "column", { options: { axis: () => override } })
    expect(list.axes).toEqual([])
    expect(list.c.axis()).toBe("x")
    override = undefined
    list.c.resolve()
    expect(list.axes).toEqual(["y"])
    expect(list.c.axis()).toBe("y")
    list.c.dispose()
    e.dispose()
  })

  it("RC4: an item's samples drive the group: moves past a neighbour reorder through onReorder; end ends the gesture", async () => {
    const e = makeEngine(makeSink().sink)
    const list = await mountList(e, "column")
    const b = list.items.get("b")!
    expect(b.driver.dragAxis()).toBe("y")
    const drag = dragY(b, 40, 10)
    expect(list.reorders).toEqual([["a", "c", "b"]])
    drag.end()
    // The gesture is over: the group ignores a move for b now.
    expect(Reorder.dragMove(list.c.group, "b", { x: 0, y: 500 })).toEqual({ x: 0, y: 0 })
    list.c.dispose()
    e.dispose()
  })

  it("RC5: an item disposed mid-gesture ends the gesture and its Auto-scroll", async () => {
    const e = makeEngine(makeSink().sink)
    const scroller = el(stage(), "position:absolute;left:0;top:0;width:220px;height:200px;overflow:auto")
    const list = await mountList(e, "column", { n: 8, parent: scroller })
    const b = list.items.get("b")!
    const at = centre(b.element)
    const bottom = scroller.getBoundingClientRect().bottom
    // Drag b to 15 px from the scroller's bottom edge, moving down.
    b.handle.dragStart()
    b.driver.onSample(sample("start", at, { x: 0, y: 0 }, 0))
    const steps = 10
    const speed = { x: 0, y: (bottom - 15 - at.y) / steps / 0.016 }
    for (let k = 1; k <= steps; k++) {
      const offset = { x: 0, y: ((bottom - 15 - at.y) * k) / steps }
      b.handle.dragMove(offset)
      b.driver.onSample(sample("move", at, offset, 16 * k, speed))
    }
    expect(list.logs().some((l) => l.event === "auto-scroll start")).toBe(true)
    b.driver.dispose()
    expect(list.logs().at(-1)?.event).toBe("auto-scroll stop")
    expect(Reorder.dragMove(list.c.group, "b", { x: 0, y: 500 })).toEqual({ x: 0, y: 0 })
    list.c.dispose()
    e.dispose()
  })

  it("RC6: an item re-registered with the same value in the same task is warned of once per controller, naming the binding's keying; in a later task it isn't", async () => {
    const e = makeEngine(makeSink().sink)
    const list = await mountList(e, "column", { options: { keyedWith: "<For>" } })
    const remounts = () => e.logs.filter((l) => l.message.includes("remounted with the same value"))
    const reRegister = (value: string): void => {
      const item = list.items.get(value)!
      item.unregister()
      const handle = e.system.register({ id: `${value}2`, element: item.element, transition: () => ({ type: "spring" }) })
      list.items.set(value, { ...item, handle, unregister: list.c.item(value, () => item.element).register(handle) })
    }
    list.items.get("a")!.unregister()
    await endOfTask()
    const a = list.items.get("a")!
    list.c.item("a", () => a.element).register(e.system.register({ id: "a2", element: a.element, transition: () => ({ type: "spring" }) }))
    expect(remounts()).toEqual([])
    reRegister("b")
    expect(remounts().map((l) => l.annotations.value)).toEqual(["b"])
    expect(remounts()[0]!.message).toContain("key items with <For>")
    reRegister("c")
    expect(remounts()).toHaveLength(1)
    list.c.dispose()
    e.dispose()
  })

  it("RC7: valuesChanged() runs a Measure pass; after dispose no pass reports an axis", async () => {
    const e = makeEngine(makeSink().sink)
    const list = await mountList(e, "column")
    const before = e.spans.length
    list.c.valuesChanged()
    await endOfTask()
    expect(e.spans.length).toBe(before + 1)
    list.c.dispose()
    list.container.style.flexDirection = "row"
    e.system.notify()
    await endOfTask()
    expect(list.axes).toEqual(["y"])
    e.dispose()
  })

  it("RC8: the group element's direction is read at each drag start", async () => {
    const e = makeEngine(makeSink().sink)
    const list = await mountList(e, "row")
    list.container.style.direction = "rtl"
    const drag = dragY(list.items.get("b")!, 0, 1)
    drag.end()
    const start = list.logs().find((l) => l.event === "reorder start")
    expect(start?.annotations.direction).toBe("rtl")
    list.c.dispose()
    e.dispose()
  })
})
