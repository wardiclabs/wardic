import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { wardic } from "~/lib/wardic.ts"

const Model = Schema.Struct({ moved: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Move: {} })
type Message = typeof Message.Type

export const init = (): Model => ({ moved: false })
export const update = (model: Model, message: Message) => Message.match(message, { Move: () => ({ model: { moved: !model.moved } }) })

/** One toggle, three ways to get there: a spring, a tween, and keyframes. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  const x = model.moved ? 160 : 0
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button"), h.OnClick(Message.Move())], ["Move"]),
    w.div([h.Class("sample-box"), w.Animate({ x }), w.Transition({ type: "spring", stiffness: 300, damping: 14 })], ["spring"]),
    w.div([h.Class("sample-box"), w.Animate({ x }), w.Transition({ duration: 0.6, ease: "easeInOut" })], ["tween"]),
    w.div([h.Class("sample-box"), w.Initial(false), w.Animate({ x: model.moved ? [0, 200, 160] : [160, -40, 0] }), w.Transition({ duration: 0.8, times: [0, 0.6, 1] })], ["keyframes"]),
  ])
}
