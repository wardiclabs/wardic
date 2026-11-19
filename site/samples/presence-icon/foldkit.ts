import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Features, Wardic } from "@wardic/foldkit"

// This app plays exits: its Handle names `presence` among its Features.
const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.presence] })

const Model = Schema.Struct({ playing: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Toggle: {} })
type Message = typeof Message.Type

export const init = (): Model => ({ playing: false })
export const update = (model: Model, message: Message) => Message.match(message, { Toggle: () => ({ model: { playing: !model.playing } }) })

/** Each icon turns in a quarter turn from half its size, and turns out the same way on. */
const TURN = {
  initial: { opacity: 0, scale: 0.5, rotate: -90 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.5, rotate: 90 },
  transition: { type: "spring", visualDuration: 0.3, bounce: 0.3 },
} as const

/** A play button whose icon swaps for a pause one: each icon an `<svg>`, keyed, the leaving one popped out of the flow. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  const icon = (key: string, shapes: ReadonlyArray<Html>): Html =>
    w.keyed("svg")(key, [h.ViewBox("0 0 24 24"), h.Width("22"), h.Height("22"), w.Initial(TURN.initial), w.Animate(TURN.animate), w.Exit(TURN.exit), w.Transition(TURN.transition)], shapes)
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button sample-icon-button"), h.AriaLabel(model.playing ? "Pause" : "Play"), h.OnClick(Message.Toggle())], [
      // The leaving icon is popped: it turns out over the new one, not beside it, and the button keeps its size.
      w.span([w.Presence({ mode: "popLayout", initial: false })], [
        model.playing
          ? icon("pause", [h.rect([h.X("6"), h.Y("5"), h.Width("4"), h.Height("14"), h.Rx("1")]), h.rect([h.X("14"), h.Y("5"), h.Width("4"), h.Height("14"), h.Rx("1")])])
          : icon("play", [h.path([h.D("M7 5 L19 12 L7 19 Z")])]),
      ]),
    ]),
    h.p([h.Class("sample-note")], [model.playing ? "Playing" : "Paused"]),
  ])
}
