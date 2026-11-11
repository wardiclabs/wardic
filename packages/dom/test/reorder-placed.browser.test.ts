// The Reorder controller for placed items (#712, ADR-0072 decision 6): a Batch Reorder group's items
// are placed from their index, never measured, so the controller runs with no projection system. Each
// item registers a plain handle, its box computed from its place; what tells the controller the boxes
// are fresh is the binding's `placed()`, once its Batch has placed a new order. This test plays the
// binding: a column of items, each `position: absolute` in its group and placed by its transform.
//
// - RP1: `makePlaced` needs only an Announcer. A drag past a neighbour's place reorders; the next
//   crossover waits until the new order is placed (its handles' versions risen, as the binding raises
//   them as it places), and then goes. `placed()`'s own part, the reveal, is RP3's.
// - RP2: a keyboard lift raises the item through its handle and is spoken; a drop lets it down.
// - RP3: after a step, `placed()` reveals the item's new place in its scroller, from its place, not
//   where it's still drawn.
// - RP4: once its Scope has closed, `placed()` reveals nothing.
// - RP5: a drag near its scroller's edge, moving toward it, scrolls the scroller: Auto-scroll over the group.
// - RP6: a binding that places a new order inside `onReorder` itself, as a Batch Reorder group's does: a
//   step's and a cancel's reveals still come, though `placed()` is told before the step returns.
// - RP7 (#721, Q3): a binding whose `values()` is a new array at every read, the same items in the same
//   order (a store's order read as a plain array), keeps a lifted item through its steps, telling
//   `valuesChanged()` at each: the group knows its own order by its items. The app's own order, another
//   order of them, drops it at its new place.
import type * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import * as Announcer from "@wardic/core/Announcer"
import * as Reorder from "@wardic/core/Reorder"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type { PassEnds } from "../src/internal/pass-ends.ts"
import * as ReorderController from "@wardic/dom/ReorderController"
import { afterEach, describe, expect, it } from "vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"

const STEP = 40
const HEIGHT = 36
const WIDTH = 200

const stages: Array<HTMLElement> = []
afterEach(() => {
  for (const s of stages.splice(0)) s.remove()
})

/** Item `i`'s place in its group: a column, one item every `STEP` px. */
const placeOf = (i: number) => ({ x: 0, y: i * STEP })

interface Placed {
  readonly controller: ReorderController.Placed<string>
  readonly scroller: HTMLElement
  readonly order: () => ReadonlyArray<string>
  /** The app's own order, set as an app sets `values`. */
  readonly setOrder: (next: ReadonlyArray<string>) => void
  readonly elements: Map<string, HTMLElement>
  readonly drivers: Map<string, ReorderController.ItemDriver>
  readonly lifts: Array<string>
  readonly said: Array<string>
  /** The binding's placing: each item drawn at its place, the versions risen, `placed()` told. */
  readonly place: (draw?: boolean) => void
  /** The dragged item's offset from its place now, as the binding gives it. */
  dragOffset: { x: number; y: number }
  readonly close: () => Promise<void>
}

/** How the scene's binding behaves: placing a new order inside `onReorder`, and reading its order as a new array each time. */
interface Binding {
  readonly placesAtOnce?: boolean
  readonly copies?: boolean
}

const mount = async (n: number, { placesAtOnce = false, copies = false }: Binding = {}): Promise<Placed> => {
  const values = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i))
  let order: ReadonlyArray<string> = values
  // Set once the scene's made: a binding that places at once places within `onReorder`.
  let placeNow: () => void = () => {}
  const said: Array<string> = []
  const lifts: Array<string> = []
  const scroller = document.createElement("div")
  scroller.style.cssText = `position:relative;width:${WIDTH}px;height:120px;overflow:auto`
  const groupEl = document.createElement("ul")
  groupEl.style.cssText = `position:relative;margin:0;padding:0;list-style:none;height:${n * STEP}px`
  scroller.append(groupEl)
  document.body.append(scroller)
  stages.push(scroller)
  const scope = Effect.runSync(Scope.make())
  const announcer = Layer.succeed(Announcer.Announcer, { announce: (message) => said.push(message) })
  const controller = Effect.runSync(
    ReorderController.makePlaced<string>({
      // A store's order, read as a plain array: a new one at every read.
      values: () => Bool.match(copies, { onTrue: () => [...order], onFalse: () => order }),
      onReorder: (next) => {
        order = next
        if (placesAtOnce) placeNow()
      },
      axis: () => Option.some<Reorder.Axis>("y"),
    }).pipe(
      Effect.provide(announcer),
      Scope.provide(scope),
    ),
  )
  controller.attach(groupEl)
  let version = 0
  const elements = new Map<string, HTMLElement>()
  const drivers = new Map<string, ReorderController.ItemDriver>()
  const placed: Placed = {
    controller,
    scroller,
    order: () => order,
    setOrder: (next) => {
      order = next
    },
    elements,
    drivers,
    lifts,
    said,
    dragOffset: { x: 0, y: 0 },
    place: (draw = true) => {
      if (draw) for (const v of order) elements.get(v)!.style.transform = `translateY(${placeOf(order.indexOf(v)).y}px)`
      version++
      controller.placed()
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
  for (const v of values) {
    const element = document.createElement("li")
    element.style.cssText = `position:absolute;top:0;left:0;width:${WIDTH}px;height:${HEIGHT}px`
    element.textContent = v
    groupEl.append(element)
    elements.set(v, element)
    const driver = controller.item(v, () => Option.some(element))
    drivers.set(v, driver)
    const box = () => {
      const at = placeOf(order.indexOf(v))
      return { x: { min: at.x, max: at.x + WIDTH }, y: { min: at.y, max: at.y + HEIGHT } }
    }
    driver.register({
      layoutBox: () => Option.some(box()),
      dragOffset: () => placed.dragOffset,
      layoutVersion: () => version,
      setLifted: (lifted) => lifts.push(`${v} ${String(lifted)}`),
      placeOnScreen: () => {
        const group = groupEl.getBoundingClientRect()
        const b = box()
        return { left: group.left + b.x.min, top: group.top + b.y.min, right: group.left + b.x.max, bottom: group.top + b.y.max }
      },
    })
  }
  placed.place()
  placeNow = () => placed.place()
  return placed
}

const sample = (phase: Drag.Sample["phase"], offset: { x: number; y: number }, timeStamp: number, vy = 0): Drag.Sample => ({
  phase,
  point: { x: 100 + offset.x, y: 18 + offset.y },
  offset,
  delta: { x: 0, y: 0 },
  velocity: { x: 0, y: vy },
  timeStamp,
  scroll: { x: 0, y: 0 },
  axis: "y",
})

const key = (name: InputSource.KeyboardLikeEvent["key"]): InputSource.KeyboardLikeEvent => ({
  type: "down",
  key: name,
  repeat: false,
  timeStamp: 0,
  fromTarget: true,
  handled: false,
  handle: () => {},
  action: "none",
})

describe("the Reorder controller for placed items (#712)", () => {
  it("RP1: built with only an Announcer; a drag past a neighbour's place reorders, the next crossover waiting for the new order's placing", async () => {
    // Its context needs no projection system and no Measure-pass ends.
    type Needs = Effect.Services<ReturnType<typeof ReorderController.makePlaced<string>>>
    const needsNoProjection: Extract<Needs, ProjectionSystem.ProjectionSystem | PassEnds> extends never ? true : false = true
    expect(needsNoProjection).toBe(true)
    const p = await mount(3)
    const a = p.drivers.get("a")!
    a.onSample(sample("start", { x: 0, y: 0 }, 0))
    // Past b's centre (58): a's bottom at 36 + 45.
    p.dragOffset = { x: 0, y: 45 }
    a.onSample(sample("move", p.dragOffset, 16, 2000))
    expect(p.order(), "past b").toEqual(["b", "a", "c"])
    // Not placed yet: a further move past c's centre reorders nothing.
    p.dragOffset = { x: 0, y: 91 - STEP }
    a.onSample(sample("move", { x: 0, y: 91 }, 32, 2000))
    expect(p.order(), "waiting for the placing").toEqual(["b", "a", "c"])
    p.place()
    a.onSample(sample("move", { x: 0, y: 92 }, 48, 2000))
    expect(p.order(), "placed, the next crossover").toEqual(["b", "c", "a"])
    a.onSample(sample("end", { x: 0, y: 92 }, 64))
    await p.close()
  })

  it("RP2: a keyboard lift raises the item through its handle and is spoken; a drop lets it down", async () => {
    const p = await mount(3)
    const a = p.drivers.get("a")!
    a.onKey(key("space"))
    expect(p.lifts, "raised").toEqual(["a true"])
    expect(p.said.at(-1), "the lift spoken").toMatch(/a/)
    a.onKey(key("space"))
    expect(p.lifts, "let down").toEqual(["a true", "a false"])
    await p.close()
  })

  it("RP3: after a step, placed() reveals the item's new place, not where it's still drawn", async () => {
    const p = await mount(10)
    const a = p.drivers.get("a")!
    p.elements.get("a")!.focus()
    a.onKey(key("space"))
    a.onKey(key("end"))
    expect(p.order().at(-1), "stepped to the end").toBe("a")
    expect(p.scroller.scrollTop, "nothing revealed before the placing").toBe(0)
    // Placed, but still drawn at the top: the reveal goes by its place, at the end of the column.
    p.place(false)
    expect(p.scroller.scrollTop, "its place in view").toBe(9 * STEP + HEIGHT - 120)
    await p.close()
  })

  it("RP4: once its Scope has closed, placed() reveals nothing", async () => {
    const p = await mount(10)
    const a = p.drivers.get("a")!
    a.onKey(key("space"))
    a.onKey(key("end"))
    await p.close()
    p.place(false)
    expect(p.scroller.scrollTop).toBe(0)
  })

  it("RP5: a drag near its scroller's edge, moving toward it, scrolls the scroller", async () => {
    const p = await mount(10)
    const a = p.drivers.get("a")!
    a.onSample(sample("start", { x: 0, y: 0 }, 0))
    const bottom = p.scroller.getBoundingClientRect().bottom
    // The pointer 10 px inside the scroller's bottom edge, moving down.
    const near: Drag.Sample = { ...sample("move", { x: 0, y: 80 }, 16, 800), point: { x: 100, y: bottom - 10 } }
    a.onSample(near)
    expect(p.scroller.scrollTop, "scrolled toward the edge").toBeGreaterThan(0)
    a.onSample(sample("end", { x: 0, y: 80 }, 32))
    await p.close()
  })

  it("RP6: a binding that places inside onReorder: a step's and a cancel's reveals still come", async () => {
    const p = await mount(10, { placesAtOnce: true })
    const a = p.drivers.get("a")!
    p.elements.get("a")!.focus()
    a.onKey(key("space"))
    a.onKey(key("end"))
    expect(p.order().at(-1), "stepped to the end").toBe("a")
    expect(p.scroller.scrollTop, "its place in view").toBe(9 * STEP + HEIGHT - 120)
    // Escape puts it back at the top, its place revealed again.
    a.onKey(key("escape"))
    expect(p.order()[0], "back at the start").toBe("a")
    expect(p.scroller.scrollTop, "its place in view").toBe(0)
    await p.close()
  })

  it("RP7 (#721): values() a new array at every read: a lift goes on through its steps; the app's own order drops it", async () => {
    const p = await mount(4, { copies: true })
    const a = p.drivers.get("a")!
    a.onKey(key("space"))
    for (const step of [1, 2]) {
      a.onKey(key("down"))
      // The binding: the new order read as a new array, told, then placed.
      p.controller.valuesChanged()
      p.place()
      expect(p.order().indexOf("a"), `step ${step}: a moved on`).toBe(step)
    }
    expect(p.lifts, "still lifted after two steps").toEqual(["a true"])
    // The app's own order while a is lifted: dropped, at its new place.
    p.setOrder(["d", "c", "a", "b"])
    p.controller.valuesChanged()
    p.place()
    expect(p.lifts, "dropped by the app's own order").toEqual(["a true", "a false"])
    a.onKey(key("down"))
    expect(p.order(), "no longer lifted: an arrow moves nothing").toEqual(["d", "c", "a", "b"])
    await p.close()
  })
})
