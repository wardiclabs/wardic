// Values and Effects (#791, PR 3): the held frame's cure (a Retarget from a patch paints its first step
// in the patch's frame, P20), `Wardic.animate` and `Wardic.provide` from Commands, Live values in
// `w.Style`, `w.Text`, `w.OnUpdate` and `w.TransformTemplate`.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import { Features, LiveValue } from "@wardic/foldkit"
import type * as Ward from "@wardic/foldkit/Ward"
import * as Wardic from "@wardic/foldkit/Wardic"
import { paintedReads, until } from "../../solid/test/browser-helpers.ts"
import { boxOf, embed, type Embedded, frames } from "./harness.ts"

const Model = Schema.Struct({ x: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Set: { x: Schema.Number } })
type Message = typeof Message.Type
const update = (model: Model, message: Message) => Message.match(message, { Set: ({ x }) => ({ model: { ...model, x } }) })

const wardic = Wardic.make({ env: DomLive })

const xOf = (app: Pick<Embedded<never>, "container">, box: HTMLElement): number => box.getBoundingClientRect().left - app.container.getBoundingClientRect().left

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

describe("the held frame (P20, decision 32)", () => {
  it("a Retarget from a patch paints its first step in the patch's frame, not its origin", async () => {
    const held = embed<Model, Message, number>({
      Model,
      Set: Schema.Number,
      init: { x: 0 },
      update,
      view: (model, h) => {
        const w = wardic.html(h)
        return w.div([h.Id("box"), w.Initial({ x: 0 }), w.Animate({ x: model.x }), w.Transition({ duration: 0.5, ease: "linear" }), h.Style({ width: "40px", height: "40px" })])
      },
      toMessage: (x) => Message.Set({ x }),
    })
    app = held
    const box = await boxOf(held)
    // Settled at 0, idle. The Message's patch runs in the next Refresh frame; the first read is after that frame's paint.
    held.send(300)
    const reads = await paintedReads(() => xOf(held, box), 3)
    expect(reads[0], "moved in the patch's own frame").toBeGreaterThan(0)
    expect(reads[1]).toBeGreaterThan(reads[0]!)
    expect(reads[2]).toBeGreaterThan(reads[1]!)
  })

  it("a leaver's exit, started by the presence's delivery with no setter called, takes its first step in the patch's frame too (#792, Q7)", async () => {
    const Items = Schema.Struct({ items: Schema.Array(Schema.String) })
    type Items = typeof Items.Type
    const ItemsMessage = defineMessageUnion({ Items: { items: Schema.Array(Schema.String) } })
    type ItemsMessage = typeof ItemsMessage.Type
    const presenced = Wardic.make({ env: DomLive, features: [Features.presence] })
    const held = embed<Items, ItemsMessage, ReadonlyArray<string>>({
      Model: Items,
      Set: Schema.Array(Schema.String),
      init: { items: ["a", "b"] },
      update: (model, message) => ItemsMessage.match(message, { Items: ({ items }) => ({ model: { ...model, items } }) }),
      view: (model, h) => {
        const w = presenced.html(h)
        return w.ul([h.Id("list"), w.Presence({})], model.items.map((key) =>
          w.keyed("li")(key, [h.Id(`item-${key}`), w.Initial({ opacity: 1 }), w.Exit({ opacity: 0 }), w.Transition({ duration: 0.5, ease: "linear" })], [key])))
      },
      toMessage: (items) => ItemsMessage.Items({ items }),
    })
    app = held
    const b = await boxOf(held, "item-b")
    // Settled, idle. The removal's patch calls no setter: the delivery's hint opens the window for the exit's legs.
    held.send(["a"])
    const reads = await paintedReads(() => Bool.match(b.style.opacity === "", { onTrue: () => 1, onFalse: () => Number(b.style.opacity) }), 3)
    expect(reads[0], "faded in the patch's own frame").toBeLessThan(1)
    expect(reads[1]).toBeLessThan(reads[0]!)
    expect(reads[2]).toBeLessThan(reads[1]!)
  })

  it("a layout move, measured by the pass the layout observer's delivery asks for, takes its first step in the patch's frame too (#792, Q7)", async () => {
    const Items = Schema.Struct({ items: Schema.Array(Schema.String) })
    type Items = typeof Items.Type
    const ItemsMessage = defineMessageUnion({ Items: { items: Schema.Array(Schema.String) } })
    type ItemsMessage = typeof ItemsMessage.Type
    const laid = Wardic.make({ env: DomLive, features: [Features.layout] })
    const held = embed<Items, ItemsMessage, ReadonlyArray<string>>({
      Model: Items,
      Set: Schema.Array(Schema.String),
      init: { items: ["a", "b", "c"] },
      update: (model, message) => ItemsMessage.match(message, { Items: ({ items }) => ({ model: { ...model, items } }) }),
      view: (model, h) => {
        const w = laid.html(h)
        return h.ul([h.Id("list"), h.Style({ position: "relative", margin: "0", padding: "0" })], model.items.map((key) =>
          w.keyed("li")(key, [h.Id(`item-${key}`), w.Layout(true), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ height: "40px", margin: "0", padding: "0", listStyle: "none" })], [key])))
      },
      toMessage: (items) => ItemsMessage.Items({ items }),
    })
    app = held
    const c = await boxOf(held, "item-c")
    const list = await boxOf(held, "list")
    const topOfC = (): number => c.getBoundingClientRect().top - list.getBoundingClientRect().top
    await until(() => topOfC() === 80, 2000, "c rests in the third row")
    // Settled, idle. The reorder's patch moves c's node to the top; the pass seeds it back at 80 and its first step paints in that frame.
    held.send(["c", "a", "b"])
    const reads = await paintedReads(topOfC, 3)
    expect(reads[0], "moved in the patch's own frame: below 80, above 0").toBeLessThan(79.5)
    expect(reads[0]).toBeGreaterThan(0)
    expect(reads[1]).toBeLessThan(reads[0]!)
    expect(reads[2]).toBeLessThan(reads[1]!)
  })
})

describe("Wardic.animate from a Command", () => {
  it("animates a w.* element and a plain one by selector, and answers with the landing", async () => {
    const Model = Schema.Struct({ ended: Schema.Array(Schema.String) })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Go: {}, Ended: { landed: Schema.Boolean }, Missing: { subject: Schema.String } })
    type Message = typeof Message.Type
    const Animate = Command.define("Animate", {
      messages: [Message.Ended, Message.Missing],
      execute: Wardic.animate(".mover", { x: 100 }, { duration: 0.2, ease: "linear" }).pipe(
        Effect.map((end) => Message.Ended({ landed: end.landed })),
        Effect.catchTag("AnimationFailed", (failure) => Effect.succeed(Message.Missing({ subject: failure.subject }))),
      ),
    })
    const Nothing = Command.define("Nothing", {
      messages: [Message.Ended, Message.Missing],
      execute: Wardic.animate("#nowhere", { x: 100 }).pipe(
        Effect.map((end) => Message.Ended({ landed: end.landed })),
        Effect.catchTag("AnimationFailed", (failure) => Effect.succeed(Message.Missing({ subject: failure.subject }))),
      ),
    })
    const held = embed<Model, Message, boolean, Wardic.Wardic>({
      Model,
      Set: Schema.Boolean,
      init: { ended: [] },
      update: (model, message) =>
        Message.match(message, {
          Go: () => ({ model, commands: [Animate(), Nothing()] }),
          Ended: ({ landed }) => ({ model: { ended: [...model.ended, `landed:${landed}`] } }),
          Missing: ({ subject }) => ({ model: { ended: [...model.ended, `missing:${subject}`] } }),
        }),
      view: (model, h) => {
        const w = wardic.html(h)
        return h.div([h.Id("root")], [
          w.div([h.Id("ward"), h.Class("mover"), w.Initial({ x: 0 }), h.Style({ width: "40px", height: "40px" })]),
          h.div([h.Id("plain"), h.Class("mover"), h.Style({ width: "40px", height: "40px" })]),
          h.ul([h.Id("ended")], model.ended.map((e) => h.li([], [e]))),
        ])
      },
      toMessage: () => Message.Go(),
      resources: wardic.resources,
    })
    app = held
    const ward = await boxOf(held, "ward")
    const plain = await boxOf(held, "plain")
    const ended = (): ReadonlyArray<string> => Array.from(held.container.querySelectorAll("#ended li")).map((li) => li.textContent)
    held.send(true)
    await until(() => ended().length === 2, 3000, "both Commands answer")
    expect(ended()).toContain("landed:true")
    expect(ended()).toContain("missing:#nowhere")
    expect(xOf(held, ward)).toBe(100)
    expect(xOf(held, plain)).toBe(100)
  })
})

/** A Live value an app makes at module scope. */
const liveX = Atom.make(50)

describe("Live values", () => {
  it("w.Style follows an Atom set through Wardic.provide, from a Starting style read before the provider exists", async () => {
    const Model = Schema.Struct({ done: Schema.Boolean })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Go: {}, Done: { at: Schema.Number } })
    type Message = typeof Message.Type
    // A spring made on the provider's services, in the Command's own Scope: held until it rests at 200.
    const Spring = Command.define("Spring", {
      messages: [Message.Done],
      execute: Effect.scoped(
        Wardic.provide(
          Effect.gen(function* () {
            const registry = yield* AtomRegistry.AtomRegistry
            const smooth = yield* LiveValue.spring(liveX, { stiffness: 400, damping: 40 })
            registry.set(liveX, 200)
            yield* Effect.repeat(Effect.sleep("20 millis"), { until: () => Math.abs(registry.get(smooth) - 200) < 0.5 })
            return Message.Done({ at: registry.get(smooth) })
          }),
        ),
      ),
    })
    const held = embed<Model, Message, boolean, Wardic.Wardic>({
      Model,
      Set: Schema.Boolean,
      init: { done: false },
      update: (model, message) => Message.match(message, { Go: () => ({ model, commands: [Spring()] }), Done: () => ({ model: { done: true } }) }),
      view: (model, h) => {
        const w = wardic.html(h)
        return h.div([h.Id("root")], [
          w.div([h.Id("box"), w.Style({ x: liveX }), h.Style({ width: "40px", height: "40px" })]),
          h.span([h.Id("done")], [String(model.done)]),
        ])
      },
      toMessage: () => Message.Go(),
      resources: wardic.resources,
    })
    app = held
    const box = await boxOf(held)
    // The Starting style read the Atom's value before any provider: the view rendered it.
    expect(box.style.transform).toBe("translateX(50px)")
    held.send(true)
    await until(() => xOf(held, box) === 200, 3000, "the element follows the Atom to 200")
    await until(() => held.container.querySelector("#done")?.textContent === "true", 3000, "the spring rested and the Command answered")
  })

  it("w.Style follows a scroll's progress from Wardic.scroll in a Command, on a Handle with Features.scroll (#795)", async () => {
    const scrolling = Wardic.make({ env: DomLive, features: [Features.scroll] })
    const progress = Atom.make(0)
    const Model = Schema.Struct({ done: Schema.Boolean })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Go: {}, Done: {} })
    type Message = typeof Message.Type
    // The panel's scroll as Live values, on the Handle's scroll Feature, in the Command's own Scope: held until the panel is half scrolled.
    const Track = Command.define("Track", {
      messages: [Message.Done],
      execute: Effect.scoped(
        Wardic.provide(
          Effect.gen(function* () {
            const registry = yield* AtomRegistry.AtomRegistry
            // By the panel's own id: the Command can't close over `held`, whose `update` closes over the Command.
            const { scrollYProgress } = yield* Effect.orDie(Wardic.scroll({ container: document.querySelector("#scroll-panel") }))
            const stop = registry.subscribe(scrollYProgress, (at) => registry.set(progress, at), { immediate: true })
            yield* Effect.addFinalizer(() => Effect.sync(stop))
            yield* Effect.repeat(Effect.sleep("20 millis"), { until: () => registry.get(progress) >= 0.5 })
            return Message.Done()
          }),
        ),
      ),
    })
    const held = embed<Model, Message, boolean, Wardic.Wardic>({
      Model,
      Set: Schema.Boolean,
      init: { done: false },
      update: (model, message) => Message.match(message, { Go: () => ({ model, commands: [Track()] }), Done: () => ({ model: { done: true } }) }),
      view: (model, h) => {
        const w = scrolling.html(h)
        return h.div([h.Id("root")], [
          w.div([h.Id("bar"), w.Style({ scaleX: progress }), h.Style({ width: "100px", height: "4px", background: "teal", "transform-origin": "left" })]),
          h.div([h.Id("scroll-panel"), h.Style({ height: "100px", overflow: "auto" })], [h.div([h.Style({ height: "300px" })])]),
          h.span([h.Id("done")], [String(model.done)]),
        ])
      },
      toMessage: () => Message.Go(),
      resources: scrolling.resources,
    })
    app = held
    const bar = await boxOf(held, "bar")
    const panel = await boxOf(held, "scroll-panel")
    held.send(true)
    // Two frames: the Message's patch has run and the Command has its listener on the panel before it's scrolled.
    await frames(2)
    // Half of the panel's 200 px of scroll.
    panel.scrollTop = 100
    await until(() => bar.style.transform.includes("scaleX(0.5)"), 3000, "the bar follows the panel's scroll to its half")
    await until(() => held.container.querySelector("#done")?.textContent === "true", 3000, "the Command answered once the panel was half scrolled")
  })

  it("Wardic.scroll fails typed on a Handle without Features.scroll (#795)", async () => {
    const Model = Schema.Struct({ reason: Schema.String })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Go: {}, Ended: { reason: Schema.String } })
    type Message = typeof Message.Type
    // The file's Handle has no scroll Feature: the Command answers with the failure's reason, as an app would with its words.
    const Track = Command.define("TrackWithout", {
      messages: [Message.Ended],
      execute: Effect.scoped(Wardic.scroll({ container: document.body })).pipe(
        Effect.map(() => Message.Ended({ reason: "read" })),
        Effect.catchTag("ScrollFailed", (failure) => Effect.succeed(Message.Ended({ reason: failure.reason }))),
      ),
    })
    const held = embed<Model, Message, boolean, Wardic.Wardic>({
      Model,
      Set: Schema.Boolean,
      init: { reason: "" },
      update: (model, message) => Message.match(message, { Go: () => ({ model, commands: [Track()] }), Ended: ({ reason }) => ({ model: { reason } }) }),
      view: (model, h) => {
        const w = wardic.html(h)
        return h.div([h.Id("root")], [w.div([h.Id("box")]), h.span([h.Id("reason")], [model.reason])])
      },
      toMessage: () => Message.Go(),
      resources: wardic.resources,
    })
    app = held
    await boxOf(held)
    held.send(true)
    await until(() => held.container.querySelector("#reason")?.textContent === "no-scroll-feature", 3000, "the Command answers with the typed failure's reason")
  })

  it("w.Style follows the pointer over an element from Wardic.pointer in a Command: a mouse's moves, not a finger's, and its leave (#833)", async () => {
    const across = Atom.make(0)
    const inside = Atom.make(false)
    const Model = Schema.Struct({ done: Schema.Boolean })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Go: {}, Done: {} })
    type Message = typeof Message.Type
    // The pad's pointer as Live values, in the Command's own Scope: held until the pointer has crossed a quarter of the pad and left.
    const Follow = Command.define("Follow", {
      messages: [Message.Done],
      execute: Effect.scoped(
        Wardic.provide(
          Effect.gen(function* () {
            const registry = yield* AtomRegistry.AtomRegistry
            // By the pad's own id: the Command can't close over `held`, whose `update` closes over the Command.
            const values = yield* Wardic.pointer(Option.getOrThrow(Option.fromNullOr(document.querySelector("#pad"))))
            const stops = [registry.subscribe(values.xProgress, (at) => registry.set(across, at), { immediate: true }), registry.subscribe(values.inside, (is) => registry.set(inside, is), { immediate: true })]
            yield* Effect.addFinalizer(() => Effect.sync(() => stops.forEach((stop) => stop())))
            yield* Effect.repeat(Effect.sleep("20 millis"), { until: () => registry.get(across) >= 0.25 && registry.get(inside) === false })
            return Message.Done()
          }),
        ),
      ),
    })
    const held = embed<Model, Message, boolean, Wardic.Wardic>({
      Model,
      Set: Schema.Boolean,
      init: { done: false },
      update: (model, message) => Message.match(message, { Go: () => ({ model, commands: [Follow()] }), Done: () => ({ model: { done: true } }) }),
      view: (model, h) => {
        const w = wardic.html(h)
        return h.div([h.Id("root")], [
          w.div([h.Id("bar"), w.Style({ scaleX: across }), h.Style({ width: "100px", height: "4px", background: "teal", "transform-origin": "left" })]),
          w.span([h.Id("inside"), w.Text(Atom.map(inside, String))]),
          h.div([h.Id("pad"), h.Style({ width: "200px", height: "100px" })]),
          h.span([h.Id("done")], [String(model.done)]),
        ])
      },
      toMessage: () => Message.Go(),
      resources: wardic.resources,
    })
    app = held
    const bar = await boxOf(held, "bar")
    const pad = await boxOf(held, "pad")
    const insideEl = await boxOf(held, "inside")
    const at = (type: string, fraction: number, pointerType: string): void => {
      const box = pad.getBoundingClientRect()
      pad.dispatchEvent(new PointerEvent(type, { clientX: box.left + box.width * fraction, clientY: box.top + box.height / 2, pointerType, bubbles: true }))
    }
    held.send(true)
    // The mouse moves at each poll until the bar follows: the Command's listeners go on the pad after the Message's patch, at no fixed frame.
    await until(() => {
      at("pointermove", 0.25, "mouse")
      return bar.style.transform.includes("scaleX(0.25)")
    }, 3000, "the bar follows the mouse to a quarter across")
    await until(() => insideEl.textContent === "true", 1000, "the text says the pointer is inside")
    // A finger's move: not among the default types, so nothing moves.
    at("pointermove", 0.75, "touch")
    await frames(2)
    expect(bar.style.transform).toContain("scaleX(0.25)")
    at("pointerleave", 0.25, "mouse")
    await until(() => insideEl.textContent === "false", 3000, "the leave turns inside off")
    await until(() => held.container.querySelector("#done")?.textContent === "true", 3000, "the Command answered once the pointer had crossed and left")
  })

  it("w.Text writes an Atom's text, w.OnUpdate sinks the element's values, and w.TransformTemplate shapes its transform", async () => {
    const latest = Atom.make<Ward.Latest>({})
    const label = Atom.map(latest, (values) => Math.round(Number(values["x"] ?? 0)))
    const template = (_values: Readonly<Record<string, string | number>>, generated: string): string => `${generated} rotate(10deg)`
    const held = embed<Model, Message, number>({
      Model,
      Set: Schema.Number,
      init: { x: 0 },
      update,
      view: (model, h) => {
        const w = wardic.html(h)
        return h.div([h.Id("root")], [
          w.div([h.Id("box"), w.Initial({ x: 0 }), w.Animate({ x: model.x }), w.Transition({ duration: 0.2, ease: "linear" }), w.OnUpdate(latest), w.TransformTemplate(template), h.Style({ width: "40px", height: "40px" })]),
          w.span([h.Id("label"), w.Text(label)]),
        ])
      },
      toMessage: (x) => Message.Set({ x }),
    })
    app = held
    const box = await boxOf(held)
    const labelEl = await boxOf(held, "label")
    expect(labelEl.textContent, "the Atom's value, written at mount").toBe("0")
    held.send(100)
    await until(() => labelEl.textContent === "100", 3000, "the text follows the element's values")
    await until(() => box.style.transform === "translateX(100px) rotate(10deg)", 2000, "the template shapes the landed transform")
  })
})
