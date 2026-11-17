// Reorder on Foldkit (#793, PR 3; ADR-0020, ADR-0037; ADR-0071 decision 28): `w.ReorderGroup` on the
// list and `w.ReorderItem(value)` on each keyed item, dom's controller underneath. The order lives in
// the Model: `onReorder` sends a Message with the new order at each Crossover, the render puts the items
// in it, and the Measure pass measures the new slots. Each fixture pins what the binding owns; the
// Crossover, Auto-scroll and the keys are dom's and core's, tested with Solid's.
//
// - R1: a drag of an item past its neighbour sends `Items` with the new order; the Model takes it, the
//   DOM follows, and the item lands on its new slot at the release.
// - R2: the guard under both triggers (Q11): after a Crossover the group makes no further one until the
//   new order's boxes are measured, by the observer's pass under `"patch"` and the binding's ask under
//   `"declared"`: one drag across two neighbours ends two places down either way.
// - R3: the **Reorder hold** (#348): `OnHoldStart` at the drag's start, not the press; `OnReorderEnd` then
//   `OnHoldEnd` (`how: "drop"`) at the release; a click is no hold; dropped back where it was, no `OnReorderEnd`.
// - R4: the **Keyboard reorder** (ADR-0037): each item a tab stop with the instructions in
//   `aria-describedby`; Space lifts (announced, `WhileDrag` on), ArrowDown sends the new order, Space drops.
// - R5: Escape cancels: the order back from the lift, `OnHoldEnd` with `"cancel"`, no `OnReorderEnd`.
// - R6: a `StartsDrag` item (Q8, Q20): with `DragListener(false)` and `DragControls`, a press on its
//   body reorders nothing and it takes no touch-action; a press on its grip reorders it.
// - R7: `keyboard: false`: no tab stop and no instructions; `axis: "x"`: a row's items drag sideways,
//   their touch-action `pan-y`.
// - R8: without `Features.drag`, `w.ReorderGroup` is a type error and inert, said once; an unkeyed item
//   and an item outside a group are warned in development.
// - R9: `Layout("position")` beside the item still reorders; the app's own reorder (a render) animates
//   the items to their new slots.
// - R10: under a lazy load (Q15), the group and its items join as the Features arrive, nothing said before.
import { DomLive } from "@wardic/dom"
import * as Arr from "effect/Array"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as DragControls from "@wardic/foldkit/DragControls"
import * as Features from "@wardic/foldkit/Features"
import * as Wardic from "@wardic/foldkit/Wardic"
import type * as Ward from "@wardic/foldkit/Ward"
import { leftOf, raf, topOf, until } from "../../solid/test/browser-helpers.ts"
import { add, glide, wait } from "../../solid/test/real-mouse.ts"
import { boxOf, centreOf, embed, type Embedded, FAST, landsAt, logged, mouse, PARK, said, saidTimes, settledBox } from "./harness.ts"

const Model = Schema.Struct({ items: Schema.Array(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Items: { items: Schema.Array(Schema.String) }, Seen: { call: Schema.String } })
type Message = typeof Message.Type

// What the fixtures' callbacks sent, as `update` heard them.
let calls: Array<string> = []

const update = (model: Model, message: Message) =>
  Message.match(message, {
    Items: ({ items }) => ({ model: { ...model, items } }),
    Seen: ({ call }) => {
      calls.push(call)
      return { model }
    },
  })

/** The builder of a Handle with every DOM Feature. */
type W = Wardic.Html<Message, typeof Features.domMax>

const ROW = { height: "40px", margin: "0", padding: "0", listStyle: "none", background: "#9cf" } as const
const LIST = { position: "relative", margin: "0", padding: "0", width: "200px" } as const

/** The ids of `#list`'s items, in DOM order. */
const domOrder = (app: Pick<Embedded<never>, "container">): ReadonlyArray<string> =>
  Array.from(app.container.querySelectorAll<HTMLElement>("#list > li"), (li) => li.id.replace("item-", ""))

/** What the live region last showed: the last **Announcement**. */
const announced = (): string => (document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)?.textContent ?? "").replace(/ $/, "")

/** A group whose reorders send `Items`, and whose holds and ends send `Seen` calls. */
const telling = (w: W, model: Model, more: Partial<Ward.ReorderGroupOptions<Message, string>> = {}): ReadonlyArray<Ward.Attribute> => [
  w.ReorderGroup<string>({
    values: model.items,
    onReorder: (items) => Message.Items({ items }),
    onReorderEnd: (end) => Message.Seen({ call: `reorderEnd ${end.value} ${end.from}>${end.to} ${end.values.join("")}` }),
    onHoldStart: (start) => Message.Seen({ call: `holdStart ${start.value} ${start.from}` }),
    onHoldEnd: (end) => Message.Seen({ call: `holdEnd ${end.value} ${end.how} ${end.values.join("")}` }),
    ...more,
  }),
]

/** A program whose view is a reorderable list of `items`, with `group` on the list and `item` on each row, embedded. */
const embedList = <F>(
  wardic: Wardic.Handle<F>,
  items: ReadonlyArray<string>,
  group: (w: Wardic.Html<Message, F>, model: Model) => ReadonlyArray<Ward.Attribute>,
  item: (w: Wardic.Html<Message, F>, key: string) => ReadonlyArray<Ward.Attribute> = () => [],
  row: Record<string, string> = ROW,
): Embedded<ReadonlyArray<string>> =>
  embed<Model, Message, ReadonlyArray<string>>({
    Model,
    Set: Schema.Array(Schema.String),
    init: { items },
    update,
    view: (model, h) => {
      const w = wardic.html(h)
      // The Handle has `drag` and `layout`, given or on their way: its builder's `ReorderItem` is callable.
      const items = w as unknown as W
      return h.div([h.Style({ position: "absolute", top: "100px", left: "100px" })], [
        w.ul([h.Id("list"), h.Style(LIST), ...group(w, model)], Arr.map(model.items, (key) =>
          w.keyed("li")(key, [h.Id(`item-${key}`), h.Style(row), items.ReorderItem(key), ...item(w, key)], [key]))),
      ])
    },
    toMessage: (items) => Message.Items({ items }),
  })

let apps: Array<Embedded<ReadonlyArray<string>>> = []
const mounted = (app: Embedded<ReadonlyArray<string>>): Embedded<ReadonlyArray<string>> => {
  apps.push(app)
  return app
}

afterEach(async () => {
  apps.forEach((app) => app.dispose())
  apps = []
  calls = []
  await mouse.move(PARK)
})

describe("w.ReorderGroup and w.ReorderItem (#793, PR 3; ADR-0020)", () => {
  it("R1: a drag past a neighbour sends the new order, the Model takes it, the DOM follows, and the item lands on its new slot", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(embedList(wardic, ["a", "b", "c"], (w, model) => [w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })]))
    const b = await settledBox(app, "item-b")
    const c = await boxOf(app, "item-c")
    const slotOfC = topOf(c)
    const g = centreOf(b)
    await mouse.down(g)
    // 50 px down: b's bottom edge passes c's centre, the Crossover.
    await glide(g, add(g, 0, 50), 5)
    await until(() => domOrder(app).join("") === "acb", 2000, "the render put b after c")
    await mouse.up(add(g, 0, 50))
    await until(() => Math.abs(topOf(b) - slotOfC) < 0.5, 2000, "b lands on c's former slot")
    expect(domOrder(app)).toEqual(["a", "c", "b"])
  })

  it("R2: the guard under both triggers: one drag across two neighbours ends two places down", async () => {
    for (const layoutTrigger of ["patch", "declared"] as const) {
      const wardic = Wardic.make({ env: DomLive, features: Features.domMax, layoutTrigger })
      const app = mounted(embedList(wardic, ["a", "b", "c", "d"], (w, model) => [w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })]))
      const b = await settledBox(app, "item-b")
      const g = centreOf(b)
      await mouse.down(g)
      // 90 px down in 9 steps: past c's centre, then, once the new order is measured, past d's.
      await glide(g, add(g, 0, 90), 9, 30)
      await until(() => domOrder(app).join("") === "acdb", 3000, `b two places down under "${layoutTrigger}"`)
      await mouse.up(add(g, 0, 90))
      await wait(100)
      expect(domOrder(app), layoutTrigger).toEqual(["a", "c", "d", "b"])
      app.dispose()
      await mouse.move(PARK)
    }
  })

  it("R3: the Reorder hold: OnHoldStart at the drag's start, OnReorderEnd then OnHoldEnd at the release; a click is no hold; dropped back, no OnReorderEnd", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(embedList(wardic, ["a", "b", "c"], telling))
    const b = await settledBox(app, "item-b")
    const c = await boxOf(app, "item-c")
    const slotOfB = topOf(b)
    const g = centreOf(b)
    await mouse.down(g)
    await raf()
    await raf()
    expect(calls, "a press is no hold").toEqual([])
    await glide(g, add(g, 0, 50), 5)
    await until(() => domOrder(app).join("") === "acb", 2000, "the Crossover")
    expect(calls[0], "the hold's start at the drag's start, with the index then").toBe("holdStart b 1")
    await mouse.up(add(g, 0, 50))
    await until(() => calls.some((call) => call.startsWith("holdEnd")), 2000, "the hold's end")
    expect(calls, "the reorder's end, then the hold's").toEqual(["holdStart b 1", "reorderEnd b 1>2 acb", "holdEnd b drop acb"])
    calls = []
    await mouse.move(PARK)
    // c flies up to b's former slot: pressed once it's there.
    await until(() => Math.abs(topOf(c) - slotOfB) < 0.5, 2000, "c lands on its new slot")

    const h = centreOf(c)
    await mouse.down(h)
    await mouse.up(h)
    await wait(100)
    expect(calls, "a click is no hold").toEqual([])

    // Dragged down 12 px and let go: no Crossover, so no reorder's end, and the hold ends where it was.
    await mouse.down(h)
    await glide(h, add(h, 0, 12), 3)
    await until(() => calls.includes("holdStart c 1"), 2000, "the hold's start")
    await mouse.up(add(h, 0, 12))
    await until(() => calls.some((call) => call.startsWith("holdEnd")), 2000, "the hold's end")
    expect(calls, "dropped back: the hold's end alone").toEqual(["holdStart c 1", "holdEnd c drop acb"])
  })

  it("R4: the Keyboard reorder: a tab stop with the instructions; Space lifts and WhileDrag applies, ArrowDown sends the new order, Space drops", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(embedList(wardic, ["a", "b", "c"], telling, (w) => [w.Transition(FAST), w.Animate({ opacity: 1 }), w.WhileDrag({ opacity: 0.5 })]))
    const b = await settledBox(app, "item-b")
    expect(b.getAttribute("tabindex"), "a tab stop").toBe("0")
    expect(document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent, "the instructions, described by").toBe(ReorderController.DEFAULT_INSTRUCTIONS)
    b.focus()
    await commands.realKey("press", "Space")
    await until(() => announced() === "Picked up b, position 2 of 3.", 2000, "the lift announced")
    await landsAt(b, 0.5, "WhileDrag on while lifted")
    expect(calls, "the hold's start at the lift").toEqual(["holdStart b 1"])
    await commands.realKey("press", "ArrowDown")
    await until(() => domOrder(app).join("") === "acb", 2000, "the step's new order rendered")
    await until(() => announced() === "b, position 3 of 3.", 2000, "the step announced")
    expect(document.activeElement, "focus stays on the item").toBe(b)
    await commands.realKey("press", "Space")
    await until(() => announced() === "Dropped b at position 3 of 3.", 2000, "the drop announced")
    await landsAt(b, 1, "WhileDrag off at the drop")
    await wait(50)
    expect(calls).toEqual(["holdStart b 1", "reorderEnd b 1>2 acb", "holdEnd b drop acb"])
  })

  it("R5: Escape cancels: the order back from the lift, OnHoldEnd with cancel, no OnReorderEnd", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(embedList(wardic, ["a", "b", "c"], telling))
    const b = await settledBox(app, "item-b")
    b.focus()
    await commands.realKey("press", "Space")
    await until(() => announced() === "Picked up b, position 2 of 3.", 2000, "lifted")
    await commands.realKey("press", "ArrowDown")
    await until(() => domOrder(app).join("") === "acb", 2000, "stepped")
    await commands.realKey("press", "Escape")
    await until(() => domOrder(app).join("") === "abc", 2000, "the order back")
    expect(announced()).toBe("Cancelled. b is back at position 2 of 3.")
    await wait(50)
    expect(calls, "no reorder's end for a cancel").toEqual(["holdStart b 1", "holdEnd b cancel abc"])
  })

  it("R6: a StartsDrag item: its body reorders nothing and takes no touch-action; its grip reorders it", async () => {
    // Controls made apart from the view, one set per item, as `DragControls.make` says.
    const controls = new Map<string, DragControls.DragControls>()
    const controlsOf = (key: string): DragControls.DragControls => {
      const known = controls.get(key)
      if (known !== undefined) return known
      const made = DragControls.make()
      controls.set(key, made)
      return made
    }
    const GRIP = { display: "inline-block", width: "20px", height: "40px", background: "gray", "touch-action": "none" } as const
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(
      embed<Model, Message, ReadonlyArray<string>>({
        Model,
        Set: Schema.Array(Schema.String),
        init: { items: ["a", "b", "c"] },
        update,
        view: (model, h) => {
          const w = wardic.html(h)
          return h.div([h.Style({ position: "absolute", top: "100px", left: "100px" })], [
            w.ul([h.Id("list"), h.Style(LIST), w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })], Arr.map(model.items, (key) =>
              w.keyed("li")(key, [h.Id(`item-${key}`), h.Style(ROW), w.ReorderItem(key), w.DragListener(false), w.DragControls(controlsOf(key))], [
                w.span([h.Id(`grip-${key}`), h.Style(GRIP), w.StartsDrag(controlsOf(key))], []),
                key,
              ]))),
          ])
        },
        toMessage: (items) => Message.Items({ items }),
      }),
    )
    const b = await settledBox(app, "item-b")
    expect(b.style.touchAction, "no touch-action: its own presses don't drag it").toBe("")
    const body = add(centreOf(b), 40, 0)
    await mouse.down(body)
    await glide(body, add(body, 0, 50), 5)
    await mouse.up(add(body, 0, 50))
    await wait(150)
    expect(domOrder(app), "its body dragged nothing").toEqual(["a", "b", "c"])
    const grip = centreOf(await boxOf(app, "grip-b"))
    await mouse.down(grip)
    await glide(grip, add(grip, 0, 50), 5)
    await until(() => domOrder(app).join("") === "acb", 2000, "the grip's drag reordered it")
    await mouse.up(add(grip, 0, 50))
  })

  it("R7: keyboard false gives no tab stop and no instructions; a row with axis x drags sideways, touch-action pan-y", async () => {
    // Cells of a row, 60 px wide.
    const CELL = { display: "inline-block", width: "60px", height: "40px", margin: "0", padding: "0", background: "#9cf" }
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(
      embedList(wardic, ["a", "b", "c"], (w, model) => [w.ReorderGroup({ values: model.items, axis: "x", keyboard: false, onReorder: (items) => Message.Items({ items }) })], () => [], CELL),
    )
    const b = await settledBox(app, "item-b")
    expect(b.hasAttribute("tabindex"), "no tab stop").toBe(false)
    expect(b.hasAttribute("aria-describedby"), "no instructions").toBe(false)
    expect(b.style.touchAction, "a row keeps vertical panning").toBe("pan-y")
    const c = await boxOf(app, "item-c")
    const slotOfC = leftOf(c)
    const g = centreOf(b)
    await mouse.down(g)
    await glide(g, add(g, 70, 0), 5)
    await until(() => domOrder(app).join("") === "acb", 2000, "b past c, sideways")
    await mouse.up(add(g, 70, 0))
    await until(() => Math.abs(leftOf(b) - slotOfC) < 0.5, 2000, "b on c's former slot")
  })

  it("R8: without Features.drag the group is a type error and inert, said once; an unkeyed item and one outside a group are warned", async () => {
    const layoutOnly = Wardic.make({ env: DomLive, features: [Features.layout] })
    const lines = await logged(async () => {
      const app = mounted(
        embed<Model, Message, ReadonlyArray<string>>({
          Model,
          Set: Schema.Array(Schema.String),
          init: { items: ["a", "b"] },
          update,
          view: (model, h) => {
            const w = layoutOnly.html(h)
            return h.div([h.Style({ position: "absolute", top: "100px", left: "100px" })], [
              // @ts-expect-error `ReorderGroup` needs the `drag` Feature, which this Handle wasn't given: `NeedsFeature<"drag">`
              w.ul([h.Id("list"), h.Style(LIST), w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })], Arr.map(model.items, (key) =>
                // @ts-expect-error `ReorderItem` needs the `drag` Feature too
                w.keyed("li")(key, [h.Id(`item-${key}`), h.Style(ROW), w.ReorderItem(key)], [key]))),
            ])
          },
          toMessage: (items) => Message.Items({ items }),
        }),
      )
      const a = await settledBox(app, "item-a")
      const g = centreOf(a)
      await mouse.down(g)
      await glide(g, add(g, 0, 50), 5)
      await mouse.up(add(g, 0, 50))
      await wait(150)
      expect(domOrder(app), "inert").toEqual(["a", "b"])
    })
    expect(saidTimes(lines, "needs the `drag` Feature"), "said once").toBe(1)

    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const warned = await logged(async () => {
      const app = mounted(
        embed<Model, Message, ReadonlyArray<string>>({
          Model,
          Set: Schema.Array(Schema.String),
          init: { items: ["a"] },
          update,
          view: (model, h) => {
            const w = wardic.html(h)
            return h.div([h.Style({ position: "absolute", top: "100px", left: "100px" })], [
              w.ul([h.Id("list"), h.Style(LIST), w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })], [
                w.li([h.Id("item-a"), h.Style(ROW), w.ReorderItem("a")], ["a"]),
              ]),
              w.li([h.Id("stray"), h.Style(ROW), w.ReorderItem("stray")], ["stray"]),
            ])
          },
          toMessage: (items) => Message.Items({ items }),
        }),
      )
      await settledBox(app, "stray")
    })
    expect(said(warned, "a w.ReorderItem is on an unkeyed element"), "the unkeyed item").toBe(true)
    expect(said(warned, "a w.ReorderItem has no w.ReorderGroup above it"), "the stray item").toBe(true)
  })

  it("R9: Layout(\"position\") beside the item still reorders; the app's own reorder animates the items to their new slots", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(embedList(wardic, ["a", "b", "c"], (w, model) => [w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })], (w) => [w.Layout("position"), w.Transition({ duration: 0.3, ease: "linear" })]))
    const b = await settledBox(app, "item-b")
    const c = await boxOf(app, "item-c")
    const slotOfC = topOf(c)
    const g = centreOf(b)
    await mouse.down(g)
    await glide(g, add(g, 0, 50), 5)
    await until(() => domOrder(app).join("") === "acb", 2000, "reordered")
    await mouse.up(add(g, 0, 50))
    await until(() => Math.abs(topOf(b) - slotOfC) < 0.5, 2000, "b on c's former slot")
    await mouse.move(PARK)
    // The app's own order, a render: c (now first after a) flies to the end, over the 0.3 s transition.
    const slotOfA = topOf(await boxOf(app, "item-a"))
    app.send(["a", "b", "c"])
    await until(() => domOrder(app).join("") === "abc", 2000, "rendered")
    await raf()
    await raf()
    const flying = topOf(c)
    expect(flying, "c on its way down from its old slot").toBeGreaterThan(slotOfA + 40 - 39)
    expect(flying).toBeLessThan(slotOfA + 80)
    await until(() => Math.abs(topOf(c) - (slotOfA + 80)) < 0.5, 2000, "c lands on the last slot")
  })
  it("R10: under a lazy load, the group and its items join as the Features arrive, nothing said before", async () => {
    const arrival = { resolve: (_: typeof Features.domMax): void => {} }
    const lazy = Wardic.make({
      env: DomLive,
      features: () =>
        new Promise<typeof Features.domMax>((resolve) => {
          arrival.resolve = resolve
        }),
    })
    const lines = await logged(async () => {
      const app = mounted(embedList(lazy, ["a", "b", "c"], (w, model) => [w.ReorderGroup({ values: model.items, onReorder: (items) => Message.Items({ items }) })]))
      const b = await settledBox(app, "item-b")
      expect(b.hasAttribute("tabindex"), "not joined while the load is on its way").toBe(false)
      arrival.resolve(Features.domMax)
      await until(() => b.getAttribute("tabindex") === "0", 2000, "joined as the Features arrived")
      const c = await boxOf(app, "item-c")
      const slotOfC = topOf(c)
      const g = centreOf(b)
      await mouse.down(g)
      await glide(g, add(g, 0, 50), 5)
      await until(() => domOrder(app).join("") === "acb", 2000, "reordered through the group the load made")
      await mouse.up(add(g, 0, 50))
      await until(() => Math.abs(topOf(b) - slotOfC) < 0.5, 2000, "b on c's former slot: the node the load's layout made")
    })
    expect(said(lines, "needs the"), "nothing said while the load was on its way").toBe(false)
  })
})
