import { DomLive } from "@wardic/dom"
import * as Wardic from "@wardic/foldkit/Wardic"
import * as Schema from "effect/Schema"
import type { Document, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

/** The build id both renders carry: a page from another deployment is refused (no `@foldkit/vite-plugin` here). */
export const BUILD_ID = "pack-check"

const Model = Schema.Struct({ n: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Tick: {} })
type Message = typeof Message.Type

/** The Handle, once, at module scope: the same module on the server and the client. */
export const wardic = Wardic.make({ env: DomLive })

/** An element that enters over two seconds, long enough for the check to see its Appear animation running before the script takes it over. */
const view = (_model: Model, h: HtmlBuilder<Message>): Document => {
  const w = wardic.html(h)
  return {
    title: "pack check · Foldkit, server-rendered",
    body: w.div([h.Id("root"), w.Provider()], [
      w.div([h.Id("enter"), w.Initial({ opacity: 0, x: 0 }), w.Animate({ opacity: 1, x: 120 }), w.Transition({ type: "tween", duration: 2 }), h.Style({ width: "80px", height: "40px", background: "teal" })]),
    ]),
  }
}

/** The program's config, as `makeApplication` and the server's `renderToString` take it; the client gives its container. */
export const app = {
  Model,
  init: () => ({ model: { n: 0 } }),
  update: (model: Model, message: Message) => Message.match(message, { Tick: () => ({ model: { n: model.n + 1 } }) }),
  view,
}
