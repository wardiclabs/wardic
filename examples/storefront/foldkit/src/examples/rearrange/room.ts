/**
 * The room as a Foldkit program of its own, with a Handle of its own that names `drag` alone. This
 * module is imported when you press Rearrange, so the program and its Handle arrive as one chunk
 * then, and `mount` embeds it in the plan. The shop's Handle has `drag` already (its other rooms
 * drag on it), so the bytes the press fetches are this program's.
 */
import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Runtime from "foldkit/runtime"
import { Features, Wardic } from "@wardic/foldkit"
import { PIECES, placeOf } from "./pieces.ts"

const room = Wardic.make({ env: DomLive, features: [Features.drag] })

const Model = Schema.Struct({})
type Model = typeof Model.Type

// The pieces are Wardic's to move, inside their parent: the program has no Messages of its own.
const view = (_model: Model, h: HtmlBuilder<never>): Html => {
  const w = room.html(h)
  return w.div(
    [h.Class("room-pieces")],
    PIECES.map((piece) =>
      w.keyed("div")(piece.id, [h.Class("room-piece"), h.DataAttribute("id", piece.id), w.Drag(), w.DragConstraints("parent"), w.DragElastic(0.1), w.DragMomentum(false), w.WhileDrag({ scale: 1.05 }), h.Style(placeOf(piece))], [piece.name]),
    ),
  )
}

/** The room, running in `container` until its handle is disposed. */
export const mount = (container: HTMLElement): Runtime.EmbedHandle =>
  Runtime.embed(Runtime.makeElement({ Model, init: () => ({ model: {} }), update: (model: Model, _message: never) => ({ model }), view, container, resources: room.resources }))
