// Declared layout changes and View Transitions on Foldkit (#792, PR 3; ADR-0071 decisions 26 and 33):
// `Wardic.animateLayout` from a Command animates the change the Command's Model change made, the only
// trigger beside `w.LayoutDependency` under the declared trigger, and settles once every layout
// animation it started has ended; `wardic.viewTransition` around the app's predicate lands layout
// moves and `layoutId` handovers at once in a transitioned render, so the View Transition's morph
// carries the motion (P10).
import { DomLive } from "@wardic/dom"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import { Features } from "@wardic/foldkit"
import * as Wardic from "@wardic/foldkit/Wardic"
import { leftOf, paintedReads, topOf, until } from "../../solid/test/browser-helpers.ts"
import { embed, type Embedded } from "./harness.ts"

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

const ROW = { height: "40px", margin: "0", padding: "0", listStyle: "none" } as const

describe("Wardic.animateLayout", () => {
  const declared = Wardic.make({ env: DomLive, features: [Features.layout], layoutTrigger: "declared" })
  const Model = Schema.Struct({ items: Schema.Array(Schema.String), settled: Schema.Number })
  type Model = typeof Model.Type
  const Message = defineMessageUnion({ Shuffle: { items: Schema.Array(Schema.String) }, Settled: {} })
  type Message = typeof Message.Type
  const Shuffle = Command.define("Shuffle", {
    messages: [Message.Settled],
    // A Command's Effect can't fail: a missing Feature would settle at once here.
    execute: Wardic.animateLayout().pipe(Effect.as(Message.Settled()), Effect.catchTag("LayoutFailed", () => Effect.succeed(Message.Settled()))),
  })
  const update = (model: Model, message: Message) =>
    Message.match(message, {
      // The reorder and its Command together: the Command runs after the patch, and animates what it moved.
      Shuffle: ({ items }) => ({ model: { ...model, items }, commands: [Shuffle()] }),
      Settled: () => ({ model: { ...model, settled: model.settled + 1 } }),
    })
  const listOf = (model: Model, h: HtmlBuilder<Message>): Html => {
    const w = declared.html(h)
    return h.div([], [
      h.ul([h.Id("list"), h.Style({ position: "relative", margin: "0", padding: "0" })], Arr.map(model.items, (key) =>
        w.keyed("li")(key, [h.Id(`item-${key}`), w.Layout(true), w.Transition({ duration: 0.3, ease: "linear" }), h.Style(ROW)], [key]))),
      h.span([h.Id("settled")], [String(model.settled)]),
    ])
  }

  it("animates the change the Command's Model change made, under the declared trigger, and settles once it has landed", async () => {
    const held = embed<Model, Message, ReadonlyArray<string>, Wardic.Wardic>({
      Model,
      Set: Schema.Array(Schema.String),
      init: { items: ["a", "b", "c"], settled: 0 },
      update,
      view: listOf,
      toMessage: (items) => Message.Shuffle({ items }),
      resources: declared.resources,
    })
    app = held
    await until(() => held.container.querySelector("#item-c") !== null, 2000, "the list renders")
    const c = (): HTMLElement => held.container.querySelector<HTMLElement>("#item-c")!
    const listTop = (): number => topOf(held.container.querySelector("#list")!)
    const settled = (): string => held.container.querySelector("#settled")?.textContent ?? ""
    await paintedReads(() => 0, 2)
    held.send(["c", "a", "b"])
    // Nothing watches the patch: the Command's pass seeds c back near its old slot, and it flies.
    await until(() => topOf(c()) - listTop() > 40 && topOf(c()) - listTop() < 80, 2000, "c seeds back and moves")
    expect(settled()).toBe("0")
    await until(() => Math.abs(topOf(c()) - listTop()) < 0.5, 2000, "c lands")
    await until(() => settled() === "1", 2000, "settled once every layout animation has ended")
  })

  it("fails with LayoutFailed when the Handle has no layout Feature", async () => {
    const slim = Wardic.make({ env: DomLive })
    const Outcome = Schema.Struct({ outcome: Schema.String })
    type Outcome = typeof Outcome.Type
    const OutcomeMessage = defineMessageUnion({ Go: {}, Told: { outcome: Schema.String } })
    type OutcomeMessage = typeof OutcomeMessage.Type
    const Try = Command.define("Try", {
      messages: [OutcomeMessage.Told],
      execute: Wardic.animateLayout().pipe(
        Effect.as(OutcomeMessage.Told({ outcome: "animated" })),
        Effect.catchTag("LayoutFailed", (failed) => Effect.succeed(OutcomeMessage.Told({ outcome: failed.reason }))),
      ),
    })
    const held = embed<Outcome, OutcomeMessage, boolean, Wardic.Wardic>({
      Model: Outcome,
      Set: Schema.Boolean,
      init: { outcome: "" },
      update: (model, message) => OutcomeMessage.match(message, { Go: () => ({ model, commands: [Try()] }), Told: ({ outcome }) => ({ model: { ...model, outcome } }) }),
      view: (model, h) => {
        const w = slim.html(h)
        return w.div([h.Id("app")], [h.span([h.Id("outcome")], [model.outcome])])
      },
      toMessage: () => OutcomeMessage.Go(),
      resources: slim.resources,
    })
    app = held
    await until(() => held.container.querySelector("#outcome") !== null, 2000, "renders")
    held.send(true)
    await until(() => held.container.querySelector("#outcome")?.textContent === "no-layout-feature", 2000, "LayoutFailed names the missing Feature")
  })
})

describe("wardic.viewTransition", () => {
  const wardic = Wardic.make({ env: DomLive, features: [Features.layout] })
  const Model = Schema.Struct({ clicked: Schema.Boolean })
  type Model = typeof Model.Type
  const Message = defineMessageUnion({ Clicked: {} })
  type Message = typeof Message.Type
  const update = (model: Model, message: Message) => Message.match(message, { Clicked: () => ({ model: { ...model, clicked: true } }) })
  const BOX = { position: "absolute", top: "0", width: "100px", height: "40px", background: "teal" } as const

  /** P10's render: a mover from 20 to 320, and a `pill` pair swapped, `tab-a` at 20 going and `tab-b` at 320 coming. */
  const sceneOf = (model: Model, h: HtmlBuilder<Message>): Html => {
    const w = wardic.html(h)
    return h.div([h.Id("stage"), h.Style({ position: "relative", height: "200px" })], [
      h.style([], [".vt-mover{position:absolute;top:60px;left:20px;width:100px;height:40px;background:teal}.vt-mover.clicked{left:320px}"]),
      w.div([h.Id("mover"), h.Class(Bool.match(model.clicked, { onTrue: () => "vt-mover clicked", onFalse: () => "vt-mover" })), w.Layout(true), w.Transition({ duration: 0.3, ease: "linear" })]),
      ...Bool.match(model.clicked, {
        onTrue: () => [h.section([h.Id("view-b")], [w.keyed("div")("tab-b", [h.Id("tab-b"), w.LayoutId("pill"), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ ...BOX, left: "320px" })])])],
        onFalse: () => [h.div([h.Id("view-a")], [w.keyed("div")("tab-a", [h.Id("tab-a"), w.LayoutId("pill"), h.Style({ ...BOX, left: "20px" })])])],
      }),
    ])
  }

  /** `document.startViewTransition` stubbed: the update runs at once, the handle's promises resolved. */
  const stubbed = (): (() => void) => {
    const doc = document as unknown as { startViewTransition?: ((update: () => void) => unknown) | undefined }
    const real = doc.startViewTransition
    doc.startViewTransition = (update: () => void) => {
      update()
      return { updateCallbackDone: Promise.resolve(), ready: Promise.resolve(), finished: Promise.resolve(), skipTransition: () => {} }
    }
    return () => {
      doc.startViewTransition = real
    }
  }

  const embedScene = (transition: boolean): Embedded<boolean> =>
    embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { clicked: false },
      update,
      view: sceneOf,
      toMessage: () => Message.Clicked(),
      viewTransition: wardic.viewTransition(() => transition),
    })
  const leftIn = (held: Pick<Embedded<never>, "container">, id: string): number => leftOf(held.container.querySelector(`#${id}`)!) - leftOf(held.container.querySelector("#stage")!)

  it("a transitioned render lands the layout move and the layoutId handover at once, for the morph to carry (P10)", async () => {
    const restore = stubbed()
    try {
      const held = embedScene(true)
      app = held
      await until(() => held.container.querySelector("#tab-a") !== null, 2000, "the scene renders")
      await paintedReads(() => 0, 3)
      held.send(true)
      await until(() => held.container.querySelector("#tab-b") !== null, 2000, "the render lands")
      const reads = await paintedReads(() => [leftIn(held, "mover"), leftIn(held, "tab-b")] as const, 4)
      expect(reads.every(([mover, pill]) => mover === 320 && pill === 320), `both at their places at once: ${JSON.stringify(reads)}`).toBe(true)
    } finally {
      restore()
    }
  })

  it("a render the predicate doesn't transition animates both, as any patch does", async () => {
    const restore = stubbed()
    try {
      const held = embedScene(false)
      app = held
      await until(() => held.container.querySelector("#tab-a") !== null, 2000, "the scene renders")
      await paintedReads(() => 0, 3)
      held.send(true)
      await until(() => held.container.querySelector("#tab-b") !== null, 2000, "the render lands")
      await until(() => leftIn(held, "mover") < 300 && leftIn(held, "tab-b") < 300, 2000, "both seed back and move")
      await until(() => Math.abs(leftIn(held, "mover") - 320) < 0.5 && Math.abs(leftIn(held, "tab-b") - 320) < 0.5, 2000, "both land")
    } finally {
      restore()
    }
  })
})
