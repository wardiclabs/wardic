import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { arc } from "@wardic/foldkit"
import { wardic } from "~/lib/wardic.ts"

const Model = Schema.Struct({ across: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Toss: {} })
type Message = typeof Message.Type

// One arc, made once: with no `direction`, each trip keeps to the same side of the screen.
const toss = arc({ strength: 0.6 })

export const init = (): Model => ({ across: false })
export const update = (model: Model, message: Message) => Message.match(message, { Toss: () => ({ model: { across: !model.across } }) })

/** A ball tossed across along a curve, and back. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button"), h.OnClick(Message.Toss())], ["Toss"]),
    h.div([h.Class("sample-track")], [w.div([h.Class("sample-ball"), w.Animate({ x: model.across ? 240 : 0 }), w.Transition({ path: toss, duration: 0.7, ease: "easeInOut" })])]),
  ])
}
