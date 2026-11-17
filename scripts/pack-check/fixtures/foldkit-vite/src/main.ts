import { DomLive } from "@wardic/dom"
import * as Wardic from "@wardic/foldkit/Wardic"
import * as Schema from "effect/Schema"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

const Model = Schema.Struct({ n: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Tick: {} })
type Message = typeof Message.Type

/** The Handle, once, at module scope. */
const wardic = Wardic.make({ env: DomLive })

/** An element that enters, as an app would write it. */
const view = (_model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return w.div([], [
    w.div([h.Id("enter"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition({ duration: 0.3 }), h.Style({ width: "80px", height: "40px", background: "teal" })]),
  ])
}

Runtime.run(
  Runtime.makeElement({
    Model,
    init: () => ({ model: { n: 0 } }),
    update: (model: Model, message: Message) => Message.match(message, { Tick: () => ({ model: { n: model.n + 1 } }) }),
    view,
    container: document.getElementById("app"),
  }),
)
