import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Features, Wardic } from "@wardic/foldkit"

// This app lays out: its Handle names `layout` among its Features.
const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.layout] })

const TABS = ["Bowls", "Plates", "Cups"]

const Model = Schema.Struct({ picked: Schema.String })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Pick: { name: Schema.String } })
type Message = typeof Message.Type

export const init = (): Model => ({ picked: "Bowls" })
export const update = (_model: Model, message: Message) => Message.match(message, { Pick: ({ name }) => ({ model: { picked: name } }) })

/** Tabs with one underline: each tab's has the same `LayoutId`, so it flies to the tab that's picked. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div(
    [h.Class("sample-tabs"), h.Role("tablist"), h.AriaLabel("Shelves")],
    TABS.map((name) =>
      h.button([h.Class("sample-tab"), h.Role("tab"), h.AriaSelected(model.picked === name), h.OnClick(Message.Pick({ name }))], [
        name,
        ...(model.picked === name ? [w.keyed("span")("underline", [h.Class("sample-underline"), w.LayoutId("underline")])] : []),
      ]),
    ),
  )
}
