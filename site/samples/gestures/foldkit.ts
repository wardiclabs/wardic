import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { wardic } from "~/lib/wardic.ts"

const Model = Schema.Struct({ taps: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Tapped: {} })
type Message = typeof Message.Type

export const init = (): Model => ({ taps: 0 })
export const update = (model: Model, message: Message) => Message.match(message, { Tapped: () => ({ model: { taps: model.taps + 1 } }) })

/** A button that answers hover, press and keyboard focus, and counts its taps. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    // The button's own attributes animate it, and `OnTap` sends a Message at each tap.
    w.button([h.Class("sample-button"), w.WhileHover({ scale: 1.06 }), w.WhileTap({ scale: 0.94 }), w.WhileFocus({ y: -2 }), w.OnTap(Message.Tapped())], ["Tap me"]),
    h.p([h.Class("sample-note")], [`Tapped ${model.taps} times`]),
  ])
}
