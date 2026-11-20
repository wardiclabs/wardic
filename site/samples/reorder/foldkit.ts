import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Features, Wardic } from "@wardic/foldkit"

// An item is dragged within its layout: the Handle names `drag` and `layout` among its Features.
const wardic = Wardic.make({ env: DomLive, features: [Features.drag, Features.layout] })

const Model = Schema.Struct({ rows: Schema.Array(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Reorder: { rows: Schema.Array(Schema.String) } })
type Message = typeof Message.Type

export const init = (): Model => ({ rows: ["Bowls", "Plates", "Cups", "Jugs"] })
export const update = (_model: Model, message: Message) => Message.match(message, { Reorder: ({ rows }) => ({ model: { rows } }) })

/** A list to put in order: drag a row, or focus it and lift it with Space, then use the arrows. The order lives in the Model. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return w.ul(
    [h.Class("sample-list sample-reorder"), w.ReorderGroup({ values: model.rows, onReorder: (rows) => Message.Reorder({ rows }) })],
    model.rows.map((row) => w.keyed("li")(row, [h.Class("sample-row"), w.ReorderItem(row)], [row])),
  )
}
