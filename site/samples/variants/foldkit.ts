import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { stagger } from "@wardic/foldkit"
import { wardic } from "~/lib/wardic.ts"

const ITEMS = ["Vases", "Bowls", "Plates", "Jugs"]

// The list names a variant; each item follows it with its own target. The list's transition spaces
// them out: in from the first, out from the last.
const list = {
  open: { transition: { delayChildren: stagger(0.07) } },
  closed: { transition: { delayChildren: stagger(0.05, { from: "last" }) } },
}
const item = {
  open: { opacity: 1, x: 0 },
  closed: { opacity: 0, x: -24 },
}

const Model = Schema.Struct({ open: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Toggle: {} })
type Message = typeof Message.Type

export const init = (): Model => ({ open: true })
export const update = (model: Model, message: Message) => Message.match(message, { Toggle: () => ({ model: { open: !model.open } }) })

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button"), h.OnClick(Message.Toggle())], [model.open ? "Close" : "Open"]),
    w.ul(
      [h.Class("sample-list"), w.Variants(list), w.Initial("closed"), w.Animate(model.open ? "open" : "closed")],
      ITEMS.map((name) => w.li([h.Class("sample-item"), w.Variants(item)], [name])),
    ),
  ])
}
