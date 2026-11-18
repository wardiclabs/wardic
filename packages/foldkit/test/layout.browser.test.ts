// Layout on Foldkit (#792, PR 2; ADR-0071 decision 30): a `w.Layout` element animates from where it was
// to where a patch put it, measured by a pass after every patch that changed the DOM; a `w.LayoutId`
// pair hands over across two views; a `w.LayoutGroup` keeps its ids apart; `w.LayoutDependency` asks for
// a pass under the declared trigger; the layout callbacks reach `update` as Messages, the measure ones
// as plain functions.
import { DomLive } from "@wardic/dom"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import { Features } from "@wardic/foldkit"
import * as Wardic from "@wardic/foldkit/Wardic"
import { leftOf, paintedReads, topOf, until } from "../../solid/test/browser-helpers.ts"
import { embed, type Embedded, embedKeyedList } from "./harness.ts"

const wardic = Wardic.make({ env: DomLive, features: [Features.layout] })

const ROW = { height: "40px", margin: "0", padding: "0", listStyle: "none" } as const

const itemOf = (app: Pick<Embedded<never>, "container">, key: string): HTMLElement => app.container.querySelector<HTMLElement>(`#item-${key}`)!

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

describe("w.Layout", () => {
  it("a keyed reorder's items fly to their new slots after the patch", async () => {
    const held = embedKeyedList(wardic, ["a", "b", "c"])
    app = held
    await until(() => held.container.querySelector("#item-c") !== null, 2000, "the list renders")
    const c = itemOf(held, "c")
    const listTop = topOf(held.container.querySelector("#list")!)
    expect(topOf(c) - listTop).toBeCloseTo(80, 0)
    // c to the top: Foldkit moves its node; the pass after the patch seeds it back near its old slot, and it flies.
    held.send(["c", "a", "b"])
    await until(() => topOf(c) - listTop > 40 && topOf(c) - listTop < 80, 2000, "c seeds back near its old slot and moves")
    let sawMid = false
    await until(() => {
      const top = topOf(c) - listTop
      if (top > 10 && top < 70) sawMid = true
      return top < 0.5
    }, 2000, "c lands at the top")
    expect(sawMid, "animated through the range").toBe(true)
    // a and b moved down a row, animating too, and land.
    await until(() => Math.abs(topOf(itemOf(held, "a")) - listTop - 40) < 0.5 && Math.abs(topOf(itemOf(held, "b")) - listTop - 80) < 0.5, 2000, "a and b land")
    expect(leftOf(c)).toBeCloseTo(leftOf(itemOf(held, "a")), 0)
  })
})

const ABS = { position: "absolute", top: "0", width: "100px", height: "40px", background: "teal" } as const

describe("w.LayoutId", () => {
  const Page = Schema.Struct({ page: Schema.Literals(["a", "b"]) })
  type Page = typeof Page.Type
  const PageMessage = defineMessageUnion({ Go: { page: Schema.Literals(["a", "b"]) } })
  type PageMessage = typeof PageMessage.Type
  const go = (model: Page, message: PageMessage) => PageMessage.match(message, { Go: ({ page }) => ({ model: { ...model, page } }) })

  /** Two views, each with its own `pill` element at a different place; the Model picks one. */
  const pagesOf = (model: Page, h: HtmlBuilder<PageMessage>): Html => {
    const w = wardic.html(h)
    return h.div([h.Id("stage"), h.Style({ position: "relative", height: "100px" })], [
      ...Bool.match(model.page === "a", {
        onTrue: () => [h.div([h.Id("view-a")], [w.keyed("div")("pill-a", [h.Id("pill-a"), w.LayoutId("pill"), h.Style({ ...ABS, left: "20px" })])])],
        onFalse: () => [h.section([h.Id("view-b")], [w.keyed("div")("pill-b", [h.Id("pill-b"), w.LayoutId("pill"), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ ...ABS, left: "300px" })])])],
      }),
    ])
  }

  it("a handover crosses two views: the entering pill flies from where the leaving one was", async () => {
    const held = embed<Page, PageMessage, "a" | "b">({ Model: Page, Set: Schema.Literals(["a", "b"]), init: { page: "a" }, update: go, view: pagesOf, toMessage: (page) => PageMessage.Go({ page }) })
    app = held
    await until(() => held.container.querySelector("#pill-a") !== null, 2000, "view a renders")
    const stage = (): HTMLElement => held.container.querySelector<HTMLElement>("#stage")!
    await until(() => leftOf(held.container.querySelector("#pill-a")!) - leftOf(stage()) === 20, 2000, "the pill rests at 20")
    held.send("b")
    await until(() => held.container.querySelector("#pill-b") !== null && held.container.querySelector("#pill-a") === null, 2000, "view b replaces view a")
    const pill = held.container.querySelector<HTMLElement>("#pill-b")!
    await until(() => leftOf(pill) - leftOf(stage()) < 150, 2000, "the new pill is drawn near the old one's place")
    await until(() => Math.abs(leftOf(pill) - leftOf(stage()) - 300) < 0.5, 2000, "it lands at its own place")
  })
})

describe("w.LayoutGroup", () => {
  const Tabs = Schema.Struct({ a: Schema.Number, b: Schema.Number })
  type Tabs = typeof Tabs.Type
  const TabsMessage = defineMessageUnion({ Pick: { a: Schema.Number, b: Schema.Number } })
  type TabsMessage = typeof TabsMessage.Type
  const pick = (model: Tabs, message: TabsMessage) => TabsMessage.match(message, { Pick: ({ a, b }) => ({ model: { ...model, a, b } }) })

  /** Two tab bars, each a Layout group with an `underline` under its active tab. */
  const barsOf = (model: Tabs, h: HtmlBuilder<TabsMessage>): Html => {
    const w = wardic.html(h)
    const bar = (name: "a" | "b", active: number, top: number): Html =>
      w.div([h.Id(`bar-${name}`), w.LayoutGroup({ id: name }), h.Style({ position: "absolute", top: `${top}px`, left: "20px", width: "300px", height: "40px" })], Arr.map([0, 1], (i) =>
        h.div([h.Id(`tab-${name}-${i}`), h.Style({ position: "absolute", left: `${i * 150}px`, width: "100px", height: "40px" })], [
          ...Bool.match(active === i, {
            onTrue: () => [w.keyed("div")(`under-${name}-${i}`, [h.Id(`under-${name}-${i}`), w.LayoutId("underline"), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ position: "absolute", bottom: "0", left: "0", width: "100px", height: "4px", background: "teal" })])],
            onFalse: () => [],
          }),
        ])))
    return h.div([h.Id("bars"), h.Style({ position: "relative", height: "200px" })], [bar("a", model.a, 60), bar("b", model.b, 140)])
  }

  it("two tab bars keep their own underline: a switch in one flies there, and leaves the other", async () => {
    const held = embed<Tabs, TabsMessage, Tabs>({ Model: Tabs, Set: Tabs, init: { a: 0, b: 0 }, update: pick, view: barsOf, toMessage: (tabs) => TabsMessage.Pick(tabs) })
    app = held
    await until(() => held.container.querySelector("#under-b-0") !== null, 2000, "the bars render")
    const under = (name: string): HTMLElement => held.container.querySelector<HTMLElement>(`#under-${name}`)!
    const tab = (name: string): HTMLElement => held.container.querySelector<HTMLElement>(`#tab-${name}`)!
    await until(() => leftOf(under("a-0")) === leftOf(tab("a-0")) && leftOf(under("b-0")) === leftOf(tab("b-0")), 2000, "both underlines at rest under their tabs")
    held.send({ a: 1, b: 0 })
    await until(() => held.container.querySelector("#under-a-1") !== null, 2000, "a's underline moves to tab 1")
    await until(() => leftOf(under("a-1")) < leftOf(tab("a-1")) - 50, 2000, "a's underline flies from its old tab")
    expect(leftOf(under("b-0")), "b's stays").toBeCloseTo(leftOf(tab("b-0")), 0)
    await until(() => Math.abs(leftOf(under("a-1")) - leftOf(tab("a-1"))) < 0.5, 2000, "a's lands")
    expect(leftOf(under("b-0"))).toBeCloseTo(leftOf(tab("b-0")), 0)
  })
})

describe("w.LayoutDependency under layoutTrigger: declared", () => {
  const declared = Wardic.make({ env: DomLive, features: [Features.layout], layoutTrigger: "declared" })
  const Box = Schema.Struct({ moved: Schema.Boolean, tick: Schema.Number })
  type Box = typeof Box.Type
  const BoxMessage = defineMessageUnion({ Set: { moved: Schema.Boolean, tick: Schema.Number } })
  type BoxMessage = typeof BoxMessage.Type
  const set = (model: Box, message: BoxMessage) => BoxMessage.match(message, { Set: ({ moved, tick }) => ({ model: { ...model, moved, tick } }) })

  /** A box moved by its class, which the patch trigger would see, with the Model's `tick` as its dependency. */
  const boxOf = (model: Box, h: HtmlBuilder<BoxMessage>): Html => {
    const w = declared.html(h)
    return h.div([h.Id("stage"), h.Style({ position: "relative", height: "100px" })], [
      h.style([], [".ld-box{position:absolute;top:0;left:0;width:100px;height:40px;background:teal}.ld-box.moved{left:200px}"]),
      w.div([h.Id("box"), h.Class(Bool.match(model.moved, { onTrue: () => "ld-box moved", onFalse: () => "ld-box" })), w.Layout(true), w.LayoutDependency(model.tick), w.Transition({ duration: 0.3, ease: "linear" })]),
    ])
  }
  const embedBox = (): Embedded<Box> => embed<Box, BoxMessage, Box>({ Model: Box, Set: Box, init: { moved: false, tick: 0 }, update: set, view: boxOf, toMessage: (value) => BoxMessage.Set(value) })
  const boxLeft = (held: Pick<Embedded<never>, "container">): number => leftOf(held.container.querySelector("#box")!) - leftOf(held.container.querySelector("#stage")!)

  it("the dependency at the same value asks for no pass: the class change alone moves the box to its new place at once", async () => {
    const held = embedBox()
    app = held
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    held.send({ moved: true, tick: 0 })
    await until(() => boxLeft(held) === 200, 2000, "the box moved")
    const reads = await paintedReads(() => boxLeft(held), 4)
    expect(reads.every((left) => left === 200), `at its new place throughout: ${reads}`).toBe(true)
  })

  it("the dependency at a new value asks for a pass: the box animates from its old place", async () => {
    const held = embedBox()
    app = held
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    held.send({ moved: true, tick: 1 })
    await until(() => boxLeft(held) > 0 && boxLeft(held) < 150, 2000, "the box seeds back and moves")
    await until(() => Math.abs(boxLeft(held) - 200) < 0.5, 2000, "it lands")
  })
})

describe("the observer's root", () => {
  const Count = Schema.Struct({ extra: Schema.Number })
  type Count = typeof Count.Type
  const CountMessage = defineMessageUnion({ Extra: { extra: Schema.Number } })
  type CountMessage = typeof CountMessage.Type
  const more = (model: Count, message: CountMessage) => CountMessage.match(message, { Extra: ({ extra }) => ({ model: { ...model, extra } }) })

  /** A box under the app's root, paragraphs before it as the Model says; the root carries `w.Provider()` or not. */
  const viewOf =
    (provided: boolean) =>
    (model: Count, h: HtmlBuilder<CountMessage>): Html => {
      const w = wardic.html(h)
      return w.div([...Bool.match(provided, { onTrue: () => [w.Provider()], onFalse: () => [] }), h.Id("root")], [
        // A paragraph before the box once asked for (`Arr.makeBy` and `Arr.range` never give an empty array).
        ...Bool.match(model.extra > 0, { onTrue: () => [h.p([h.Id("extra-1"), h.Style({ height: "20px", margin: "0" })], ["extra 1"])], onFalse: () => [] }),
        w.div([h.Id("box"), w.Layout(true), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ height: "40px" })], ["box"]),
      ])
    }
  const embedRoot = (provided: boolean): Embedded<number> =>
    embed<Count, CountMessage, number>({ Model: Count, Set: Schema.Number, init: { extra: 0 }, update: more, view: viewOf(provided), toMessage: (extra) => CountMessage.Extra({ extra }) })
  /** A 50 px element put before the app's host: the whole app shifts down, a change outside the app's tree. */
  const shoved = (held: Pick<Embedded<never>, "container">): HTMLElement => {
    const stray = document.createElement("div")
    stray.style.height = "50px"
    document.body.insertBefore(stray, held.container)
    return stray
  }

  it("with w.Provider() on the app's root, a change outside the app asks for no pass, and one inside does", async () => {
    const held = embedRoot(true)
    app = held
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    const box = (): HTMLElement => held.container.querySelector<HTMLElement>("#box")!
    await paintedReads(() => 0, 3)
    const at = topOf(box())
    const stray = shoved(held)
    // The app moved with the page: no pass, so the box doesn't fly from where it was.
    const outside = await paintedReads(() => topOf(box()), 4)
    expect(outside.every((top) => Math.abs(top - (at + 50)) < 0.5), `moved with the page at once: ${outside}`).toBe(true)
    // A paragraph before it, inside the root: a pass, so the box flies from where it was.
    held.send(1)
    await until(() => topOf(box()) > at + 50 && topOf(box()) < at + 70, 2000, "the box seeds back and moves")
    await until(() => Math.abs(topOf(box()) - (at + 70)) < 0.5, 2000, "it lands")
    stray.remove()
  })

  it("without w.Provider(), the observer is the body's: a change outside the app asks for a pass too", async () => {
    const held = embedRoot(false)
    app = held
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    const box = (): HTMLElement => held.container.querySelector<HTMLElement>("#box")!
    await paintedReads(() => 0, 3)
    const at = topOf(box())
    const stray = shoved(held)
    await until(() => topOf(box()) > at && topOf(box()) < at + 50, 2000, "the box seeds back and moves")
    await until(() => Math.abs(topOf(box()) - (at + 50)) < 0.5, 2000, "it lands")
    stray.remove()
  })
})

describe("w.Presence({ presenceAffectsLayout: false }) beside a layout element", () => {
  const both = Wardic.make({ env: DomLive, features: [Features.layout, Features.presence] })
  const Rows = Schema.Struct({ items: Schema.Array(Schema.String) })
  type Rows = typeof Rows.Type
  const RowsMessage = defineMessageUnion({ Items: { items: Schema.Array(Schema.String) } })
  type RowsMessage = typeof RowsMessage.Type
  const rows = (model: Rows, message: RowsMessage) => RowsMessage.match(message, { Items: ({ items }) => ({ model: { ...model, items } }) })

  /** A presence list, and a layout element below it, which a leaver's going would move up. */
  const sceneOf =
    (affects: boolean) =>
    (model: Rows, h: HtmlBuilder<RowsMessage>): Html => {
      const w = both.html(h)
      return h.div([h.Id("stage")], [
        w.ul([h.Id("list"), w.Presence({ presenceAffectsLayout: affects }), h.Style({ margin: "0", padding: "0" })], Arr.map(model.items, (key) =>
          w.keyed("li")(key, [h.Id(`item-${key}`), w.Initial({ opacity: 1 }), w.Exit({ opacity: 0 }), w.Transition({ duration: 0.1, ease: "linear" }), h.Style(ROW)], [key]))),
        w.div([h.Id("below"), w.Layout(true), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ height: "40px" })], ["below"]),
      ])
    }
  const embedScene = (affects: boolean): Embedded<ReadonlyArray<string>> =>
    embed<Rows, RowsMessage, ReadonlyArray<string>>({ Model: Rows, Set: Schema.Array(Schema.String), init: { items: ["a", "b"] }, update: rows, view: sceneOf(affects), toMessage: (items) => RowsMessage.Items({ items }) })
  const belowTop = (held: Pick<Embedded<never>, "container">): number => topOf(held.container.querySelector("#below")!) - topOf(held.container.querySelector("#stage")!)

  it("by default a leaver's going moves the element below it into the space, animated", async () => {
    const held = embedScene(true)
    app = held
    await until(() => held.container.querySelector("#below") !== null && belowTop(held) === 80, 2000, "the scene renders")
    held.send(["a"])
    await until(() => held.container.querySelector("#item-b") === null, 2000, "b gone once its exit ends")
    // The pass seeds `#below` back where it was and it flies up.
    await until(() => belowTop(held) > 40 && belowTop(held) < 80, 2000, "below seeds back and moves")
    await until(() => Math.abs(belowTop(held) - 40) < 0.5, 2000, "it lands")
  })

  it("told not to affect layout, the going asks for no pass: the element below jumps", async () => {
    const held = embedScene(false)
    app = held
    await until(() => held.container.querySelector("#below") !== null && belowTop(held) === 80, 2000, "the scene renders")
    held.send(["a"])
    await until(() => held.container.querySelector("#item-b") === null, 2000, "b gone once its exit ends")
    const reads = await paintedReads(() => belowTop(held), 4)
    expect(reads.every((top) => top === 40), `at its new place at once: ${reads}`).toBe(true)
  })
})

describe("the layout callbacks", () => {
  const Told = Schema.Struct({ moved: Schema.Boolean, started: Schema.Number, completed: Schema.Number })
  type Told = typeof Told.Type
  const ToldMessage = defineMessageUnion({ Move: {}, LayoutStarted: {}, LayoutCompleted: {} })
  type ToldMessage = typeof ToldMessage.Type
  const tell = (model: Told, message: ToldMessage) =>
    ToldMessage.match(message, {
      Move: () => ({ model: { ...model, moved: true } }),
      LayoutStarted: () => ({ model: { ...model, started: model.started + 1 } }),
      LayoutCompleted: () => ({ model: { ...model, completed: model.completed + 1 } }),
    })

  it("OnLayoutAnimationStart and OnLayoutAnimationComplete reach update as Messages; the measure callbacks are plain functions", async () => {
    const calls: Array<string> = []
    const held = embed<Told, ToldMessage, boolean>({
      Model: Told,
      Set: Schema.Boolean,
      init: { moved: false, started: 0, completed: 0 },
      update: tell,
      view: (model, h) => {
        const w = wardic.html(h)
        // Moved by its class, as the observer watches: an inline `left` would be a `style` write, which it doesn't.
        return h.div([h.Id("stage"), h.Style({ position: "relative", height: "100px" })], [
          h.style([], [".lc-box{position:absolute;top:0;left:0;width:100px;height:40px;background:teal}.lc-box.moved{left:200px}"]),
          w.div([
            h.Id("box"),
            h.Class(Bool.match(model.moved, { onTrue: () => "lc-box moved", onFalse: () => "lc-box" })),
            w.Layout(true),
            w.Transition({ duration: 0.15, ease: "linear" }),
            w.OnLayoutAnimationStart(ToldMessage.LayoutStarted()),
            w.OnLayoutAnimationComplete(ToldMessage.LayoutCompleted()),
            w.OnBeforeLayoutMeasure(() => calls.push("before")),
            w.OnLayoutMeasure((box, prev) => calls.push(`measure ${Math.round(box.x.min)} ${UndefinedOr.match(prev, { onUndefined: () => "none", onDefined: (was) => String(Math.round(was.x.min)) })}`)),
          ]),
          h.span([h.Id("told")], [`${model.started}/${model.completed}`]),
        ])
      },
      toMessage: () => ToldMessage.Move(),
    })
    app = held
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    const told = (): string => held.container.querySelector("#told")?.textContent ?? ""
    expect(told()).toBe("0/0")
    held.send(true)
    await until(() => told() === "1/0", 2000, "started, once its first step is painted")
    await until(() => told() === "1/1", 2000, "completed, once it has landed")
    const stage = leftOf(held.container.querySelector("#stage")!)
    expect(calls).toContain("before")
    expect(calls.some((call) => call === `measure ${Math.round(stage + 200)} ${Math.round(stage)}`), `the move measured, with the box before it: ${calls}`).toBe(true)
  })
})

describe("w.LayoutCrossfade (#442; #795)", () => {
  const Twins = Schema.Struct({ open: Schema.Boolean })
  type Twins = typeof Twins.Type
  const TwinsMessage = defineMessageUnion({ Open: { open: Schema.Boolean } })
  type TwinsMessage = typeof TwinsMessage.Type
  const openIt = (model: Twins, message: TwinsMessage) => TwinsMessage.match(message, { Open: ({ open }) => ({ model: { ...model, open } }) })
  const FLY = { type: "tween", duration: 0.5 } as const

  /** Twin `a` at 20, and, once open, twin `b` at 300 with `LayoutCrossfade(false)`: the handover onto `b` doesn't crossfade. */
  const twinsOf = (model: Twins, h: HtmlBuilder<TwinsMessage>): Html => {
    const w = wardic.html(h)
    return h.div([h.Id("stage"), h.Style({ position: "relative", height: "100px" })], [
      w.keyed("div")("a", [h.Id("twin-a"), w.LayoutId("lc"), w.Transition(FLY), h.Style({ ...ABS, left: "20px" })]),
      ...Bool.match(model.open, {
        onTrue: () => [w.keyed("div")("b", [h.Id("twin-b"), w.LayoutId("lc"), w.LayoutCrossfade(false), w.Transition(FLY), h.Style({ ...ABS, left: "300px" })])],
        onFalse: () => [],
      }),
    ])
  }

  /** The opacity the projection wrote: a Follower's factor, a Lead's own times its fade. */
  const op = (el: HTMLElement): number => Number(el.style.opacity || "1")

  it("beside a live twin, the new Lead flies from its twin's box at full opacity, the twin hidden from the first frame (LC1)", async () => {
    const held = embed<Twins, TwinsMessage, boolean>({ Model: Twins, Set: Schema.Boolean, init: { open: false }, update: openIt, view: twinsOf, toMessage: (open) => TwinsMessage.Open({ open }) })
    app = held
    const stage = (): HTMLElement => held.container.querySelector<HTMLElement>("#stage")!
    const a = (): HTMLElement => held.container.querySelector<HTMLElement>("#twin-a")!
    await until(() => held.container.querySelector("#twin-a") !== null && leftOf(a()) - leftOf(stage()) === 20, 2000, "twin a rests at 20")
    held.send(true)
    await until(() => held.container.querySelector("#twin-b") !== null, 2000, "twin b renders")
    const b = held.container.querySelector<HTMLElement>("#twin-b")!
    const frames: Array<{ readonly a: number; readonly b: number; readonly left: number }> = []
    await until(() => {
      frames.push({ a: op(a()), b: op(b), left: leftOf(b) - leftOf(stage()) })
      return Math.abs(leftOf(b) - leftOf(stage()) - 300) < 1
    }, 3000, "twin b lands at 300")
    expect(frames.some((f) => f.left > 60 && f.left < 260), "it flew").toBe(true)
    expect(Math.min(...frames.map((f) => f.b)), "the Lead at full opacity throughout").toBeGreaterThan(0.99)
    expect(Math.max(...frames.map((f) => f.a)), "its twin hidden throughout").toBeLessThan(0.01)
  })
})
