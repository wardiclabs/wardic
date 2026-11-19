import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Wardic } from "@wardic/foldkit"

// The Handle's Features as a load: fetched by the first `w.*` element to mount, not with the app. An
// element mounted before `drag` arrives starts its drag once it has.
const wardic = Wardic.make({ env: DomLive, features: () => import("./foldkit-drag-feature.ts").then((m) => m.drag) })

const Model = Schema.Struct({ wanted: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Load: {} })
type Message = typeof Message.Type

export const init = (): Model => ({ wanted: false })
export const update = (_model: Model, message: Message) => Message.match(message, { Load: () => ({ model: { wanted: true } }) })

/** A ball that drags once you ask: until the press the ball is a plain element, and nothing of `drag` has been fetched. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button"), h.Disabled(model.wanted), h.OnClick(Message.Load())], ["Load drag"]),
    h.div([h.Class("sample-arena")], [
      model.wanted
        ? w.div([h.Class("sample-ball"), w.Drag(), w.DragConstraints("parent"), w.WhileDrag({ scale: 1.15 })])
        : h.div([h.Class("sample-ball")]),
    ]),
    h.p([h.Class("sample-note"), h.AriaLive("polite")], [model.wanted ? "Drag is on its way: the ball drags once it has arrived." : "No drag yet: the ball stays put."]),
  ])
}
