// Presence on Foldkit (#792, PR 1; ADR-0071 decision 29): a keyed list under `w.Presence` keeps each
// removed child in its place while its `w.Exit` plays (P8), an insert during the exit lands around it,
// and every leaver is drawn at Motion's place through the reorders that follow (P19's scenarios).
import { DomLive } from "@wardic/dom"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import type * as Ward from "@wardic/foldkit/Ward"
import * as Wardic from "@wardic/foldkit/Wardic"
import { arc, Features } from "@wardic/foldkit"
import { until } from "../../solid/test/browser-helpers.ts"
import { boxOf, embed, type Embedded, frames } from "./harness.ts"

const Model = Schema.Struct({ items: Schema.Array(Schema.String), exited: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Items: { items: Schema.Array(Schema.String) }, Exited: {} })
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match(message, { Items: ({ items }) => ({ model: { ...model, items } }), Exited: () => ({ model: { ...model, exited: model.exited + 1 } }) })

const wardic = Wardic.make({ env: DomLive, features: [Features.presence] })

/** How a list's view is made: the presence's options, and whether its items animate in from opacity 0. */
interface ListOptions {
  readonly presence?: Ward.PresenceOptions<Message> | undefined
  readonly enters?: boolean | undefined
}

/** A keyed list under a presence: each item fades out over 200 ms as it leaves; a count of completed exits beside it. */
const listOf =
  (options: ListOptions) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const w = wardic.html(h)
    const enter = Bool.match(options.enters === true, { onTrue: () => [w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 })], onFalse: () => [w.Initial({ opacity: 1 })] })
    return h.div([], [
      w.ul([h.Id("list"), w.Presence(UndefinedOr.match(options.presence, { onUndefined: () => ({}), onDefined: identity }))], Arr.map(model.items, (key) =>
        w.keyed("li")(key, [h.Id(`item-${key}`), h.Class("item"), ...enter, w.Exit({ opacity: 0 }), w.Transition({ duration: 0.2, ease: "linear" }), h.Style({ height: "20px" })], [key]))),
      h.span([h.Id("exited")], [String(model.exited)]),
    ])
  }

const embedList = (items: ReadonlyArray<string>, options: ListOptions = {}): Embedded<ReadonlyArray<string>> =>
  embed<Model, Message, ReadonlyArray<string>>({ Model, Set: Schema.Array(Schema.String), init: { items, exited: 0 }, update, view: listOf(options), toMessage: (items) => Message.Items({ items }) })

/** The list's children, by key, in DOM order. */
const orderOf = (app: Pick<Embedded<never>, "container">): string => Arr.map(Array.from(app.container.querySelectorAll<HTMLElement>("#list > li")), (el) => el.id.replace("item-", "")).join("")

const itemOf = (app: Pick<Embedded<never>, "container">, key: string): HTMLElement | null => app.container.querySelector<HTMLElement>(`#item-${key}`)

const opacityOf = (el: HTMLElement | null): number => Number(el?.style.opacity ?? "")

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

describe("w.Presence", () => {
  it("keeps a removed item in its place while its Exit plays, an insert during the exit landing around it (P8)", async () => {
    const held = embedList(["a", "b", "c", "d"])
    app = held
    await until(() => orderOf(held) === "abcd", 2000, "the list renders")
    held.send(["a", "c", "d"])
    // b stays, in its place, and fades.
    await until(() => opacityOf(itemOf(held, "b")) < 1 && opacityOf(itemOf(held, "b")) > 0, 2000, "b's exit runs")
    expect(orderOf(held)).toBe("abcd")
    // x inserted after a during the exit: Foldkit puts it by its own reference, the presence keeps b after a.
    held.send(["a", "x", "c", "d"])
    await until(() => orderOf(held) === "abxcd", 2000, "x lands after the leaver")
    expect(opacityOf(itemOf(held, "b"))).toBeLessThan(1)
    // The exit ends: b is removed.
    await until(() => orderOf(held) === "axcd", 2000, "b leaves once its exit ends")
  })

  // P19's scenarios: every leaver drawn at Motion's place through the patches that follow (#675's placement).
  const scenarios: ReadonlyArray<{ readonly name: string; readonly steps: ReadonlyArray<{ readonly items: ReadonlyArray<string>; readonly placed: string }>; readonly final: string }> = [
    { name: "1: a keyed reverse during the exit", steps: [{ items: ["a", "c", "d"], placed: "abcd" }, { items: ["d", "c", "a"], placed: "dcab" }], final: "dca" },
    { name: "3: a second reorder during the same exit, Foldkit's reference the leaver", steps: [{ items: ["a", "c", "d"], placed: "abcd" }, { items: ["d", "c", "a"], placed: "dcab" }, { items: ["c", "a", "d"], placed: "cabd" }], final: "cad" },
    { name: "6: two adjacent leavers, then a reverse", steps: [{ items: ["a", "d"], placed: "abcd" }, { items: ["d", "a"], placed: "dabc" }], final: "da" },
    { name: "7b: the last child leaves, then a reverse", steps: [{ items: ["a", "b", "c"], placed: "abcd" }, { items: ["c", "b", "a"], placed: "cdba" }], final: "cba" },
  ]
  for (const scenario of scenarios) {
    it(`keeps every leaver at Motion's place: scenario ${scenario.name} (P19)`, async () => {
      const held = embedList(["a", "b", "c", "d"])
      app = held
      await until(() => orderOf(held) === "abcd", 2000, "the list renders")
      for (const step of scenario.steps) {
        held.send(step.items)
        await until(() => orderOf(held) === step.placed, 2000, `placed ${step.placed}`)
      }
      // The leavers fade while placed, and go once their exits end.
      const leavers = Arr.filter(["a", "b", "c", "d"], (key) => Bool.not(scenario.final.includes(key)))
      expect(Arr.every(leavers, (key) => opacityOf(itemOf(held, key)) < 1)).toBe(true)
      await until(() => orderOf(held) === scenario.final, 2000, `the leavers gone: ${scenario.final}`)
    })
  }

  it("hands a leaver's values to its key's fresh element when it re-enters mid-exit (P19's scenario 5, #286)", async () => {
    const held = embedList(["a", "b", "c", "d"])
    app = held
    await until(() => orderOf(held) === "abcd", 2000, "the list renders")
    held.send(["a", "c", "d"])
    await until(() => opacityOf(itemOf(held, "b")) < 0.8 && opacityOf(itemOf(held, "b")) > 0, 2000, "b's exit runs")
    const leaver = itemOf(held, "b")!
    const faded = opacityOf(leaver)
    held.send(["a", "b", "c", "d"])
    // Foldkit's fresh b takes over: one b, in its place, starting from where the leaver was and back to 1.
    await until(() => itemOf(held, "b") !== leaver && held.container.querySelectorAll("#item-b").length === 1, 2000, "the fresh b alone")
    expect(orderOf(held)).toBe("abcd")
    const fresh = itemOf(held, "b")!
    await until(() => opacityOf(fresh) > 0, 2000, "the fresh b is drawn")
    expect(opacityOf(fresh)).toBeLessThanOrEqual(1)
    expect(opacityOf(fresh)).toBeGreaterThanOrEqual(faded - 0.15)
    await until(() => opacityOf(fresh) === 1, 2000, "it lands at 1")
    expect(orderOf(held)).toBe("abcd")
  })

  it("mode wait: holds an entering item, hidden and unstarted, until the last leaver is gone, then shows it at its place (P23)", async () => {
    const held = embedList(["a", "b", "c", "d"], { presence: { mode: "wait" }, enters: true })
    app = held
    await until(() => orderOf(held) === "abcd" && opacityOf(itemOf(held, "a")) === 1, 2000, "the list renders and lands")
    held.send(["a", "c", "d"])
    await until(() => opacityOf(itemOf(held, "b")) < 1 && opacityOf(itemOf(held, "b")) > 0, 2000, "b's exit runs")
    // x enters during the exit: on Foldkit's page, but held: hidden, and not started (its Starting style stays).
    held.send(["a", "x", "c", "d"])
    await until(() => itemOf(held, "x") !== null, 2000, "x is in the list")
    expect(itemOf(held, "x")!.style.display).toBe("none")
    expect(opacityOf(itemOf(held, "x"))).toBe(0)
    expect(orderOf(held)).toBe("abxcd")
    // A reorder while x is held: Foldkit moves its known nodes, x among them, still hidden.
    held.send(["d", "c", "x", "a"])
    await until(() => orderOf(held) === "dcxab" || orderOf(held) === "dcxa", 2000, "the reverse lands, b at its place")
    expect(itemOf(held, "x")!.style.display).toBe("none")
    // b's exit ends: x goes on the page where Foldkit has it, and animates in.
    await until(() => orderOf(held) === "dcxa" && itemOf(held, "x")!.style.display === "", 2000, "x shown once b is gone")
    await until(() => opacityOf(itemOf(held, "x")) === 1, 2000, "x animates in")
  })

  it("mode wait: a held item Foldkit removes while held never shows, never exits and leaves nothing behind (P23's W3)", async () => {
    const held = embedList(["a", "b", "c", "d"], { presence: { mode: "wait" }, enters: true })
    app = held
    await until(() => orderOf(held) === "abcd" && opacityOf(itemOf(held, "a")) === 1, 2000, "the list renders and lands")
    held.send(["a", "c", "d"])
    await until(() => opacityOf(itemOf(held, "b")) < 1 && opacityOf(itemOf(held, "b")) > 0, 2000, "b's exit runs")
    held.send(["a", "x", "c", "d"])
    await until(() => itemOf(held, "x")?.style.display === "none", 2000, "x is held")
    held.send(["a", "c", "d"])
    await until(() => itemOf(held, "x") === null, 2000, "x is gone")
    expect(orderOf(held)).toBe("abcd")
    await until(() => orderOf(held) === "acd", 2000, "b gone once its exit ends, nothing else left")
    expect(itemOf(held, "x")).toBeNull()
  })

  it("mode wait: a leaver's key back while another item is held takes over and ends the wait, the held item shown at once (P23's W6)", async () => {
    const held = embedList(["a", "b", "c", "d"], { presence: { mode: "wait" }, enters: true })
    app = held
    await until(() => orderOf(held) === "abcd" && opacityOf(itemOf(held, "a")) === 1, 2000, "the list renders and lands")
    held.send(["a", "c", "d"])
    await until(() => opacityOf(itemOf(held, "b")) < 1 && opacityOf(itemOf(held, "b")) > 0, 2000, "b's exit runs")
    const leaver = itemOf(held, "b")!
    held.send(["a", "x", "c", "d"])
    await until(() => itemOf(held, "x")?.style.display === "none", 2000, "x is held")
    held.send(["a", "x", "b", "c", "d"])
    await until(() => itemOf(held, "b") !== leaver && held.container.querySelectorAll("#item-b").length === 1, 2000, "the fresh b takes over")
    await until(() => itemOf(held, "x")?.style.display === "", 2000, "x shown, the wait over")
    expect(orderOf(held)).toBe("axbcd")
    await until(() => opacityOf(itemOf(held, "x")) === 1 && opacityOf(itemOf(held, "b")) === 1, 2000, "both land")
  })

  it("mode popLayout: pops a leaver out of the flow where it was, so its siblings take their places at once", async () => {
    const held = embedList(["a", "b", "c", "d"], { presence: { mode: "popLayout" } })
    app = held
    await until(() => orderOf(held) === "abcd", 2000, "the list renders")
    const cTop = itemOf(held, "c")!.getBoundingClientRect().top
    held.send(["a", "c", "d"])
    await until(() => itemOf(held, "b")?.style.position === "absolute", 2000, "b is popped")
    expect(orderOf(held)).toBe("abcd")
    // c took b's place at once: a line up.
    expect(itemOf(held, "c")!.getBoundingClientRect().top).toBeCloseTo(cTop - 20, 0)
    await until(() => orderOf(held) === "acd", 2000, "b gone once its exit ends")
  })

  it("mode popLayout: a child swapped for another in one patch is pinned where it was, not where the enterer pushed it (#840)", async () => {
    const held = embedList(["a", "b", "c"], { presence: { mode: "popLayout" } })
    app = held
    await until(() => orderOf(held) === "abc", 2000, "the list renders")
    const aTop = itemOf(held, "a")!.getBoundingClientRect().top
    const bTop = itemOf(held, "b")!.getBoundingClientRect().top
    // x in a's place: Foldkit has put x in by the time the presence sees a taken out, so a measured then
    // sits a line lower than it was. A page swapped under popLayout is this change (the storefront's catalogue).
    held.send(["x", "b", "c"])
    await until(() => itemOf(held, "a")?.style.position === "absolute", 2000, "a is popped")
    expect(itemOf(held, "a")!.getBoundingClientRect().top, "a pinned where it was, over x").toBeCloseTo(aTop, 0)
    expect(itemOf(held, "x")!.getBoundingClientRect().top, "x in a's place").toBeCloseTo(aTop, 0)
    expect(itemOf(held, "b")!.getBoundingClientRect().top, "b where it was").toBeCloseTo(bTop, 0)
    await until(() => orderOf(held) === "xbc", 2000, "a gone once its exit ends")
  })

  it("sends onExitComplete as a Message once every leaver has animated out and been removed", async () => {
    const held = embedList(["a", "b", "c", "d"], { presence: { onExitComplete: Message.Exited() } })
    app = held
    await until(() => orderOf(held) === "abcd", 2000, "the list renders")
    const exited = (): string => held.container.querySelector("#exited")?.textContent ?? ""
    held.send(["a", "d"])
    await until(() => opacityOf(itemOf(held, "b")) < 1, 2000, "the exits run")
    expect(exited()).toBe("0")
    await until(() => orderOf(held) === "ad", 2000, "both gone")
    await until(() => exited() === "1", 2000, "told once, after the last")
  })
})

describe("w.Presence({ mode: \"popLayout\" }) across a page swap, a layoutId between the pages (#840)", () => {
  const PageName = Schema.Literals(["list", "item"])
  const Page = Schema.Struct({ page: PageName })
  type Page = typeof Page.Type
  const PageMessage = defineMessageUnion({ Show: { page: PageName } })
  type PageMessage = typeof PageMessage.Type
  const laid = Wardic.make({ env: DomLive, features: [Features.layout, Features.presence] })
  // The photo's flight, the catalogue's: along an arc.
  const FLIGHT = { layout: { type: "tween", duration: 0.6, ease: "linear", path: arc({ strength: 0.25 }) } } as const

  /**
   * Two pages under one popLayout presence: the list with a small card, and the item, taller, with the
   * card's twin as its hero at its top, keyed under a presence of its own (the storefront's catalogue,
   * whose "Next piece" slides the content). In the storefront that inner presence starts the hero at its
   * own mount, in the patch's task, before the outer presence's observer is told, and the hero's flight
   * kept the card's box as the patch pushed it (#840). This harness's pass corrects such a start, so the
   * case holds with the Mount's flush and without it: it guards the pin and the handover's shape; the
   * flush is pinned by the storefront's catalogue probed in Chromium (#840).
   */
  const pages = (model: Page, h: HtmlBuilder<PageMessage>): Html => {
    const w = laid.html(h)
    return w.div([h.Id("pages"), w.Presence({ mode: "popLayout" }), h.Style({ position: "relative", width: "300px" })], [
      Bool.match(model.page === "list", {
        onTrue: () =>
          w.keyed("section")("list", [h.Id("list"), w.Initial({ opacity: 1 }), w.Exit({ opacity: 0 }), w.Transition({ duration: 0.4, ease: "linear" })], [
            w.div([h.Id("card"), w.LayoutId("photo"), w.Transition(FLIGHT), h.Style({ width: "40px", height: "40px", background: "teal" })]),
          ]),
        onFalse: () =>
          w.keyed("article")("item", [h.Id("item"), w.Initial({ opacity: 1 }), w.Exit({ opacity: 0 }), h.Style({ height: "240px" })], [
            w.div([w.Presence({ mode: "popLayout", initial: false })], [
              w.keyed("div")("content", [h.Id("content")], [
                w.div([h.Id("hero"), w.LayoutId("photo"), w.Transition(FLIGHT), h.Style({ width: "160px", height: "160px", background: "teal" })]),
              ]),
            ]),
          ]),
      }),
    ])
  }

  it("the hero is at the card's box as its flight begins and the list is pinned where it was, as the item enters above it", async () => {
    const held = embed<Page, PageMessage, Page["page"]>({ Model: Page, Set: PageName, init: { page: "list" }, update: (model, message) => PageMessage.match(message, { Show: ({ page }) => ({ model: { ...model, page } }) }), view: pages, toMessage: (page) => PageMessage.Show({ page }) })
    app = held
    const card = await boxOf(held, "card")
    await frames(2)
    const from = card.getBoundingClientRect()
    // The item goes in before the list in the DOM: the list, 240 px lower until it's pinned, is where a
    // measurement after the patch finds the card.
    held.send("item")
    await until(() => held.container.querySelector("#hero") !== null, 2000, "the item enters")
    await frames(2)
    const hero = held.container.querySelector<HTMLElement>("#hero")!
    const early = hero.getBoundingClientRect()
    expect(Math.abs(early.top - from.top), "it starts at the card's box, not where the item pushed the list").toBeLessThan(30)
    expect(early.width, "the card's size, not the hero's 160").toBeLessThan(100)
    expect(held.container.querySelector<HTMLElement>("#list")!.getBoundingClientRect().top, "the list pinned where it was").toBeCloseTo(from.top, 0)
    await until(() => Math.abs(hero.getBoundingClientRect().width - 160) < 0.5, 3000, "landed on its own box")
    await until(() => held.container.querySelector("#list") === null, 3000, "the list gone once its exit ends")
  })
})

describe("w.Presence({ propagate: true })", () => {
  const Panels = Schema.Struct({ panels: Schema.Array(Schema.String) })
  type Panels = typeof Panels.Type
  const PanelMessage = defineMessageUnion({ Panels: { panels: Schema.Array(Schema.String) } })
  type PanelMessage = typeof PanelMessage.Type
  const updatePanels = (model: Panels, message: PanelMessage) => PanelMessage.match(message, { Panels: ({ panels }) => ({ model: { ...model, panels } }) })

  /** Panels under a presence; each panel, with no Exit of its own, holds items under a propagating presence. */
  const panelsOf = (model: Panels, h: HtmlBuilder<PanelMessage>): Html => {
    const w = wardic.html(h)
    return w.div([h.Id("panels"), w.Presence({})], Arr.map(model.panels, (panel) =>
      w.keyed("section")(panel, [h.Id(`panel-${panel}`)], [
        w.ul([h.Id(`list-${panel}`), w.Presence({ propagate: true })], Arr.map(["1", "2"], (n) =>
          w.keyed("li")(n, [h.Id(`item-${panel}${n}`), w.Initial({ opacity: 1 }), w.Exit({ opacity: 0 }), w.Transition({ duration: 0.2, ease: "linear" })], [n]))),
      ])))
  }

  it("a leaving panel's inner items run their exits, and the panel goes once they have", async () => {
    const held = embed<Panels, PanelMessage, ReadonlyArray<string>>({ Model: Panels, Set: Schema.Array(Schema.String), init: { panels: ["p", "q"] }, update: updatePanels, view: panelsOf, toMessage: (panels) => PanelMessage.Panels({ panels }) })
    app = held
    await until(() => held.container.querySelector("#item-q2") !== null, 2000, "the panels render")
    held.send(["p"])
    const item = (): HTMLElement | null => held.container.querySelector<HTMLElement>("#item-q1")
    await until(() => item() !== null && opacityOf(item()) < 1 && opacityOf(item()) > 0, 2000, "q's items exit")
    expect(held.container.querySelector("#panel-q")).not.toBeNull()
    await until(() => held.container.querySelector("#panel-q") === null, 2000, "q goes once its items have")
  })
})
