// The tree (#791, PR 2): Variant children follow the name their parent hands down, found by DOM
// ancestry at mount; stagger and `when` orchestrate them; `w.Config` and the Handle's `config` give
// defaults; the callbacks are Messages; a target's `transitionEnd` lands after it.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import * as Wardic from "@wardic/foldkit/Wardic"
import { until } from "../../solid/test/browser-helpers.ts"
import { embed, type Embedded } from "./harness.ts"

const Model = Schema.Struct({ open: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Open: { open: Schema.Boolean } })
type Message = typeof Message.Type

const update = (model: Model, message: Message) => Message.match(message, { Open: ({ open }) => ({ model: { ...model, open } }) })

const wardic = Wardic.make({ env: DomLive })

const list = { closed: { opacity: 0.2 }, open: { opacity: 1 } }
const item = { closed: { opacity: 0 }, open: { opacity: 1 } }

/** The list's `#a`, `#b` and `#c` items, with their inline opacity. */
const itemsOf = (app: Pick<Embedded<never>, "container">): ReadonlyArray<HTMLElement> => Array.from(app.container.querySelectorAll<HTMLElement>(".item"))
const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

/** A list whose name its children follow, animated by `transition`. */
const listView = (transition: object) => (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return w.ul([h.Id("list"), w.Variants(list), w.Initial("closed"), w.Animate(Bool.match(model.open, { onTrue: () => "open", onFalse: () => "closed" })), w.Transition(transition)], [
    w.keyed("li")("a", [h.Class("item"), w.Variants(item)], ["a"]),
    w.keyed("li")("b", [h.Class("item"), w.Variants(item)], ["b"]),
    w.keyed("li")("c", [h.Class("item"), w.Variants(item)], ["c"]),
  ])
}

describe("variants down the tree", () => {
  it("a Variant child follows the name its parent hands down, from its Starting style on", async () => {
    const held = embed<Model, Message, boolean>({ Model, Set: Schema.Boolean, init: { open: false }, update, view: listView({ duration: 0.2, ease: "linear" }), toMessage: (open) => Message.Open({ open }) })
    app = held
    await until(() => itemsOf(held).length === 3, 2000, "the items render")
    // Each child starts at the parent's `initial` name resolved against its own variants: `closed`, opacity 0.
    expect(itemsOf(held).map((el) => el.style.opacity)).toEqual(["0", "0", "0"])
    held.send(true)
    await until(() => itemsOf(held).every((el) => opacityOf(el) === 1), 2000, "every child lands at open")
    held.send(false)
    await until(() => itemsOf(held).every((el) => opacityOf(el) === 0), 2000, "every child lands at closed")
  })
})

/** The time each item's opacity first moved off its start, in ms from now, read every frame. */
const startTimesOf = async (app: Pick<Embedded<never>, "container">, from: number): Promise<ReadonlyArray<number>> => {
  const t0 = performance.now()
  const starts: Array<number | undefined> = [undefined, undefined, undefined]
  await until(() => {
    itemsOf(app).forEach((el, i) => {
      if (starts[i] === undefined && opacityOf(el) !== from) starts[i] = performance.now() - t0
    })
    return starts.every((t) => t !== undefined)
  }, 3000, "every item starts")
  return starts as ReadonlyArray<number>
}

describe("orchestration", () => {
  it("staggers the children by the parent's staggerChildren", async () => {
    const held = embed<Model, Message, boolean>({ Model, Set: Schema.Boolean, init: { open: false }, update, view: listView({ duration: 0.3, ease: "linear", staggerChildren: 0.15 }), toMessage: (open) => Message.Open({ open }) })
    app = held
    await until(() => itemsOf(held).length === 3, 2000, "the items render")
    held.send(true)
    const [a, b, c] = await startTimesOf(held, 0)
    // 150 ms apart, give or take a frame or two under load.
    expect(b! - a!, "b starts after a").toBeGreaterThan(90)
    expect(c! - b!, "c starts after b").toBeGreaterThan(90)
  })

  it("beforeChildren holds the children until the parent has landed", async () => {
    const held = embed<Model, Message, boolean>({ Model, Set: Schema.Boolean, init: { open: false }, update, view: listView({ duration: 0.3, ease: "linear", when: "beforeChildren" }), toMessage: (open) => Message.Open({ open }) })
    app = held
    await until(() => itemsOf(held).length === 3, 2000, "the items render")
    const parent = held.container.querySelector<HTMLElement>("#list")!
    held.send(true)
    await until(() => opacityOf(parent) > 0.3, 2000, "the parent is on its way")
    // The parent is mid-flight: no child has moved.
    expect(itemsOf(held).map(opacityOf)).toEqual([0, 0, 0])
    await until(() => opacityOf(parent) === 1, 2000, "the parent lands")
    await until(() => itemsOf(held).every((el) => opacityOf(el) > 0), 2000, "then the children start")
    await until(() => itemsOf(held).every((el) => opacityOf(el) === 1), 2000, "and land")
  })
})

describe("w.Config and the Handle's config", () => {
  it("skipAnimations on a subtree lands its elements at once; the Handle's transition is the default", async () => {
    const slow = Wardic.make({ env: DomLive, config: { transition: { duration: 2, ease: "linear" } } })
    const held = embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { open: false },
      update,
      view: (model, h) => {
        const w = slow.html(h)
        const target = Bool.match(model.open, { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0 }) })
        return w.div([h.Id("root")], [
          // The Handle's 2 s transition: still on its way 300 ms in.
          w.div([h.Id("slow"), w.Initial({ opacity: 0 }), w.Animate(target)]),
          // A subtree whose animations land at once.
          w.div([w.Config({ skipAnimations: true })], [w.div([h.Id("skipped"), w.Initial({ opacity: 0 }), w.Animate(target)])]),
        ])
      },
      toMessage: (open) => Message.Open({ open }),
    })
    app = held
    await until(() => held.container.querySelector("#skipped") !== null, 2000, "the elements render")
    const slowEl = held.container.querySelector<HTMLElement>("#slow")!
    const skipped = held.container.querySelector<HTMLElement>("#skipped")!
    held.send(true)
    await until(() => opacityOf(skipped) === 1, 500, "the skipped element lands at once")
    expect(opacityOf(slowEl), "the slow one is still on its way").toBeLessThan(0.5)
  })
})

describe("callbacks as Messages", () => {
  it("OnAnimationStart and OnAnimationComplete reach update, with the definition", async () => {
    const Model = Schema.Struct({ x: Schema.Number, events: Schema.Array(Schema.String) })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Set: { x: Schema.Number }, Started: { to: Schema.String }, Done: {} })
    type Message = typeof Message.Type
    const held = embed<Model, Message, number>({
      Model,
      Set: Schema.Number,
      init: { x: 0, events: [] },
      update: (model, message) =>
        Message.match(message, {
          Set: ({ x }) => ({ model: { ...model, x } }),
          Started: ({ to }) => ({ model: { ...model, events: [...model.events, `start:${to}`] } }),
          Done: () => ({ model: { ...model, events: [...model.events, "done"] } }),
        }),
      view: (model, h) => {
        const w = wardic.html(h)
        return w.div([h.Id("root")], [
          w.div([
            h.Id("box"),
            w.Initial({ x: 0 }),
            w.Animate({ x: model.x }),
            w.Transition({ duration: 0.2, ease: "linear" }),
            // A function handler, given the definition; and a plain Message.
            w.OnAnimationStart((definition) => Message.Started({ to: JSON.stringify(definition) })),
            w.OnAnimationComplete(Message.Done()),
          ]),
          h.ul([h.Id("events")], model.events.map((event) => h.li([], [event]))),
        ])
      },
      toMessage: (x) => Message.Set({ x }),
    })
    app = held
    const events = (): ReadonlyArray<string> => Array.from(held.container.querySelectorAll("#events li")).map((li) => li.textContent)
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    // The mount's Retarget, from `{ x: 0 }` to an equal `{ x: 0 }`, is told too, as Solid's is (#448 keeps
    // quiet only the same entry): a start and, with nothing to animate, its completion at once.
    await until(() => events().length === 2, 2000, "the mount's animation is told")
    held.send(100)
    await until(() => events().length === 4, 3000, "the animation completes")
    expect(events()).toEqual(['start:{"x":0}', "done", 'start:{"x":100}', "done"])
  })
})

describe("targets", () => {
  it("a target's transitionEnd lands after the animation, and custom resolves a dynamic variant", async () => {
    const Model = Schema.Struct({ open: Schema.Boolean })
    type Model = typeof Model.Type
    const held = embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { open: false },
      update,
      view: (model, h) => {
        const w = wardic.html(h)
        // As Solid's TE1 (#428): `open` sets `display` itself, so the fade in is shown at once.
        const dyn = { closed: { opacity: 0, transitionEnd: { display: "none" } }, open: (i: number) => ({ opacity: 1, x: i * 10, display: "block" }) }
        return w.ul([h.Id("list"), w.Variants(dyn), w.Initial("closed"), w.Animate(Bool.match(model.open, { onTrue: () => "open", onFalse: () => "closed" })), w.Transition({ duration: 0.2, ease: "linear" })], [
          w.keyed("li")("a", [h.Class("item"), w.Variants(dyn), w.Custom(1)], ["a"]),
          w.keyed("li")("b", [h.Class("item"), w.Variants(dyn), w.Custom(2)], ["b"]),
        ])
      },
      toMessage: (open) => Message.Open({ open }),
    })
    app = held
    await until(() => itemsOf(held).length === 2, 2000, "the items render")
    // Closed at mount: the Starting style carries the `transitionEnd` too (#428).
    expect(itemsOf(held).map((el) => el.style.display)).toEqual(["none", "none"])
    held.send(true)
    await until(() => itemsOf(held).every((el) => opacityOf(el) === 1), 2000, "open lands")
    // Each child's dynamic variant resolved with its own `custom`.
    expect(itemsOf(held).map((el) => el.style.transform)).toEqual(["translateX(10px)", "translateX(20px)"])
    expect(itemsOf(held).map((el) => el.style.display)).toEqual(["block", "block"])
    held.send(false)
    await until(() => itemsOf(held).every((el) => el.style.display === "none"), 2000, "closed lands, and its transitionEnd with it")
  })
})
