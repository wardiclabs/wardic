import { DomLive } from "@wardic/dom"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Features, Wardic } from "@wardic/foldkit"

// This app drags: its Handle names `drag` among its Features. An app has one Handle, so its Features
// are the app's; one that doesn't drag leaves `drag` out and never loads it.
const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.drag] })

/** A ball held inside its arena, and one that drags across and springs back. */
export const view = <Message,>(h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-arena")], [
    w.div([h.Class("sample-ball"), w.Drag(), w.DragConstraints("parent"), w.DragElastic(0.2), w.WhileDrag({ scale: 1.15 })]),
    w.div([h.Class("sample-ball sample-ball-alt"), w.Drag("x"), w.DragSnapToOrigin(), w.WhileDrag({ scale: 1.15 })]),
  ])
}
