import { DomLive } from "@wardic/dom"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { Wardic } from "@wardic/foldkit"

// Settled once `drag` has arrived: the load below resolves it, and the arena's Mount awaits it.
let arrived!: () => void
const arrival = new Promise<void>((resolve) => (arrived = resolve))

// The Handle's Features as a load: fetched by the first `w.*` element to mount, not with the app. An
// element mounted before `drag` arrives starts its drag once it has.
const wardic = Wardic.make({
  env: DomLive,
  features: () =>
    import("./foldkit-drag-feature.ts").then((m) => {
      arrived()
      return m.drag
    }),
})

const Model = Schema.Struct({ wanted: Schema.Boolean, arrivedIn: Schema.NullOr(Schema.Number) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Load: {}, Arrived: { ms: Schema.Number } })
type Message = typeof Message.Type

/** The arena's Mount: how long `drag` took to arrive, from the press that mounted the ball, told to `update`. */
const Arrival = Mount.define("DragArrival", {
  messages: [Message.Arrived],
  execute: () =>
    Effect.gen(function* () {
      const pressedAt = performance.now()
      yield* Effect.promise(() => arrival)
      return Message.Arrived({ ms: Math.round(performance.now() - pressedAt) })
    }),
})

export const init = (): Model => ({ wanted: false, arrivedIn: null })
export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Load: () => ({ model: { ...model, wanted: true } }),
    Arrived: ({ ms }) => ({ model: { ...model, arrivedIn: ms } }),
  })

const noteOf = (model: Model): string => {
  if (!model.wanted) return "No drag yet: the ball stays put."
  if (model.arrivedIn === null) return "Loading drag…"
  return `Drag arrived in ${model.arrivedIn} ms.`
}

/** A ball that drags once you ask: until the press the ball is a plain element, and nothing of `drag` has been fetched. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.button([h.Class("sample-button"), h.Disabled(model.wanted), h.OnClick(Message.Load())], ["Load drag"]),
    // The arena is keyed by the press, so its Mount starts with the ball, the first `w.*` element, whose mount starts the load.
    h.keyed("div")(String(model.wanted), [h.Class("sample-arena"), h.OnMount(Arrival())], [
      model.wanted
        ? w.div([h.Class("sample-ball"), w.Drag(), w.DragConstraints("parent"), w.WhileDrag({ scale: 1.15 })])
        : h.div([h.Class("sample-ball")]),
    ]),
    h.p([h.Class("sample-note"), h.AriaLive("polite")], [noteOf(model)]),
  ])
}
