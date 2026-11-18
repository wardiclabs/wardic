import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { correctParentTransform } from "@wardic/foldkit"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

const PIECES = [
  { id: "sofa", name: "Sofa", x: 24, y: 24, width: 120, height: 52 },
  { id: "table", name: "Table", x: 64, y: 112, width: 72, height: 44 },
  { id: "lamp", name: "Lamp", x: 236, y: 32, width: 44, height: 44 },
] as const

const Data = Schema.Struct({})
// The plan is zoomed with a CSS transform, so the pointer moves in the page's pixels while a
// piece moves in the plan's: at 140% a piece would run ahead of the pointer, at 60% lag behind.
const Model = Schema.Struct({ zoom: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Zoom: { zoom: Schema.Number } })
type Message = typeof Message.Type

// correctParentTransform turns each pointer point back through the plan's zoom, so a piece stays
// under the pointer at any zoom, and its constraints are measured in the plan's pixels. A Foldkit view
// has no refs: the plan is named by its selector, and each piece carries the mapping in its `w.Config`.
const throughPlan = correctParentTransform("#room-plan")

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return h.div([h.Class("room-demo")], [
    h.label([h.Class("room-zoom")], [
      h.span([], ["Zoom"]),
      h.input([h.Type("range"), h.Min("0.6"), h.Max("1.4"), h.Step("0.1"), h.Value(String(model.zoom)), h.OnInput((value) => Message.Zoom({ zoom: Number(value) }))]),
      h.output([], [`${Math.round(model.zoom * 100)}%`]),
    ]),
    h.div([h.Class("room-frame")], [
      h.div(
        [h.Id("room-plan"), h.Class("room-plan"), h.Style({ transform: `scale(${model.zoom})` })],
        PIECES.map((piece) =>
          w.keyed("div")(piece.id, [
            h.Class("room-piece"),
            h.DataAttribute("id", piece.id),
            w.Drag(),
            w.DragConstraints("parent"),
            w.DragElastic(0.1),
            w.DragMomentum(false),
            w.WhileDrag({ scale: 1.05 }),
            w.Config({ transformPagePoint: throughPlan }),
            h.Style({ left: `${piece.x}px`, top: `${piece.y}px`, width: `${piece.width}px`, height: `${piece.height}px` }),
          ], [piece.name]),
        ),
      ),
    ]),
  ])
})

export default definePage({
  id: "arrange-room",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ zoom: 1 }),
  update: (model, message) => Message.match(message, { Zoom: ({ zoom }) => ({ model: { ...model, zoom } }) }),
  view,
})
