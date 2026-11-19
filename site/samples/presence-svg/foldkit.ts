import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { Features, Wardic } from "@wardic/foldkit"

// This app plays exits: its Handle names `presence` among its Features.
const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.presence] })

/** Where point `id` sits on the 320 × 160 plot, spread evenly from its number, and which of four colours it takes. */
const pointAt = (id: number) => ({ cx: 20 + ((0.5 + id * 0.7549) % 1) * 280, cy: 20 + ((0.5 + id * 0.5698) % 1) * 120, tone: id % 4 })

const Model = Schema.Struct({ points: Schema.Array(Schema.Number), next: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Add: {}, Remove: { point: Schema.Number } })
type Message = typeof Message.Type

export const init = (): Model => ({ points: [1, 2, 3, 4, 5, 6, 7, 8], next: 9 })
export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Add: () => ({ model: { points: [...model.points, model.next], next: model.next + 1 } }),
    Remove: ({ point }) => ({ model: { ...model, points: model.points.filter((one) => one !== point) } }),
  })

/** Points on a plot that grow in and shrink out: a `Presence` on an `<svg>`, its children SVG circles. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.div([h.Class("sample-actions")], [
      h.button([h.Class("sample-button"), h.OnClick(Message.Add())], ["Add"]),
      h.button([h.Class("sample-button"), h.Disabled(model.points.length === 0), h.OnClick(Message.Remove({ point: model.points[0] ?? 0 }))], ["Remove"]),
    ]),
    // Each circle stays until its exit has shrunk it away.
    w.svg(
      [h.Class("sample-plot"), h.ViewBox("0 0 320 160"), h.Role("img"), h.AriaLabel(`A plot of ${model.points.length} points`), w.Presence({})],
      [
        h.line([h.X1("0"), h.Y1("53"), h.X2("320"), h.Y2("53")]),
        h.line([h.X1("0"), h.Y1("107"), h.X2("320"), h.Y2("107")]),
        ...model.points.map((point) =>
          w.keyed("circle")(String(point), [
            h.Class("sample-point"),
            h.DataAttribute("tone", String(pointAt(point).tone)),
            h.Cx(String(pointAt(point).cx)),
            h.Cy(String(pointAt(point).cy)),
            w.Initial({ r: 0, opacity: 0 }),
            w.Animate({ r: 9, opacity: 1 }),
            w.WhileHover({ r: 12 }),
            w.Exit({ r: 0, opacity: 0, transition: { duration: 0.25 } }),
            w.Transition({ type: "spring", visualDuration: 0.4, bounce: 0.4 }),
            h.OnClick(Message.Remove({ point })),
          ]),
        ),
      ],
    ),
    h.p([h.Class("sample-note")], ["Click a point to remove it."]),
  ])
}
