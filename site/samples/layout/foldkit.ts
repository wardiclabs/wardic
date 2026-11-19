import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Features, Wardic } from "@wardic/foldkit"

// This app lays out: its Handle names `layout` among its Features.
const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.layout] })

const Model = Schema.Struct({ on: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Flip: {} })
type Message = typeof Message.Type

export const init = (): Model => ({ on: false })
export const update = (model: Model, message: Message) => Message.match(message, { Flip: () => ({ model: { on: !model.on } }) })

/** A switch: the stylesheet moves its knob across, and `Layout` animates the move. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.button([h.Class("sample-switch"), h.Role("switch"), h.AriaChecked(model.on), h.AriaLabel("Lights"), h.OnClick(Message.Flip())], [
    // The patch changes `aria-checked` alone, which no layout pass watches: `LayoutDependency` says when to look for a move.
    w.span([h.Class("sample-knob"), w.Layout(true), w.LayoutDependency(model.on), w.Transition({ type: "spring", stiffness: 500, damping: 30 })]),
  ])
}
