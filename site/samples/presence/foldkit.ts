import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Features, Wardic } from "@wardic/foldkit"

// This app lays out and plays exits: its Handle names `layout` and `presence` among its Features.
const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.layout, Features.presence] })

const Model = Schema.Struct({ chips: Schema.Array(Schema.Number), next: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Add: {}, Remove: { chip: Schema.Number } })
type Message = typeof Message.Type

export const init = (): Model => ({ chips: [1, 2, 3], next: 4 })
export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Add: () => ({ model: { chips: [...model.chips, model.next], next: model.next + 1 } }),
    Remove: ({ chip }) => ({ model: { ...model, chips: model.chips.filter((one) => one !== chip) } }),
  })

/** Chips that pop in and out: each plays its `Exit` before it goes, and the rest close the gap. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button"), h.OnClick(Message.Add())], ["Add"]),
    // popLayout takes a leaving chip out of the row at once, so the rest move up as it goes. Each
    // chip is keyed, so Foldkit's patch keeps it the same element while it leaves.
    w.ul(
      [h.Class("sample-chips"), w.Presence({ mode: "popLayout" })],
      model.chips.map((chip) =>
        w.keyed("li")(String(chip), [h.Class("sample-chip"), w.Layout(true), w.Initial({ opacity: 0, scale: 0.6 }), w.Animate({ opacity: 1, scale: 1 }), w.Exit({ opacity: 0, scale: 0.6 })], [
          h.button([h.AriaLabel(`Remove ${chip}`), h.OnClick(Message.Remove({ chip }))], [`${chip} ×`]),
        ]),
      ),
    ),
  ])
}
