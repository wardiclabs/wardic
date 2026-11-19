import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { PIECES, placeOf } from "./pieces.ts"

/** How long "Slow connection" holds the import back: long enough to try a drag before the room arrives. */
const HOLD_MS = 1500

const Data = Schema.Struct({})
/** Whether Rearrange was pressed, whether the import is held back, and how long the room took to arrive from the press. */
const Model = Schema.Struct({ wanted: Schema.Boolean, slow: Schema.Boolean, arrivedIn: Schema.NullOr(Schema.Number) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Rearrange: {}, SetSlow: { on: Schema.Boolean }, Arrived: { ms: Schema.Number } })
type Message = typeof Message.Type

/**
 * The host's Mount, on the press: it imports the room's program (`room.ts`), held back on a slow
 * connection, embeds it in the host (`Runtime.embed`) and says how long that took. The program is
 * disposed when the host goes: a Replay, or another page.
 */
const Room = Mount.define("RearrangeRoom", {
  args: { slow: Schema.Boolean },
  messages: [Message.Arrived],
  execute: ({ element, slow }) =>
    Effect.gen(function* () {
      const pressedAt = performance.now()
      // A Mount's element is an Element; the host is a div, which a Foldkit program's container must be.
      if (!(element instanceof HTMLElement)) return Message.Arrived({ ms: 0 })
      if (slow) yield* Effect.sleep(HOLD_MS)
      const { mount } = yield* Effect.promise(() => import("./room.ts"))
      yield* Effect.acquireRelease(
        Effect.sync(() => mount(element)),
        (handle) => Effect.promise(() => handle.disposeAsync()),
      )
      return Message.Arrived({ ms: Math.round(performance.now() - pressedAt) })
    }),
})

/** The plan's state, which the stylesheet reads: the pieces aren't handles until the room has arrived. */
const stateOf = (model: Model): "still" | "loading" | "arrived" => {
  if (!model.wanted) return "still"
  if (model.arrivedIn === null) return "loading"
  return "arrived"
}

const status = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html | string> => {
  if (!model.wanted) return ["The room's program isn't loaded: the pieces stay put."]
  if (model.arrivedIn === null) return ["Loading the room… a drag now does nothing."]
  return [`The room arrived in ${model.arrivedIn} ms, `, h.code([], ["drag"]), " on a Handle of its own."]
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const state = stateOf(model)
  return h.div([h.Class("room-demo")], [
    h.div([h.Class("lazy-bar")], [
      w.button([h.Class("button accent rearrange"), h.Disabled(model.wanted), w.WhileHover({ y: -1 }), w.WhileTap({ scale: 0.97 }), h.OnClick(Message.Rearrange())], ["Rearrange"]),
      h.label([h.Class("switch")], [h.input([h.Type("checkbox"), h.Checked(model.slow), h.Disabled(model.wanted), h.OnClick(Message.SetSlow({ on: !model.slow }))]), h.span([], ["Slow connection"])]),
      h.output([h.Class("lazy-status"), h.AriaLive("polite")], status(h, model)),
    ]),
    h.div([h.Class("room-frame")], [
      h.div([h.Class("room-plan"), h.DataAttribute("drag", state)], [
        // The page's own pieces, until the room's program draws its own in their places.
        ...(state === "arrived" ? [] : PIECES.map((piece) => h.div([h.Class("room-piece"), h.DataAttribute("id", piece.id), h.Style(placeOf(piece))], [piece.name]))),
        // The host the program is embedded in, mounted by the press, with the switch as it was then. A
        // Foldkit container has an id, for the Model preservation of its development reloads.
        ...(model.wanted ? [h.div([h.Id("room-host"), h.Class("room-host"), h.OnMount(Room({ slow: model.slow }))])] : []),
      ]),
    ]),
  ])
})

export default definePage({
  id: "rearrange",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ wanted: false, slow: false, arrivedIn: null }),
  update: (model, message) =>
    Message.match(message, {
      Rearrange: () => ({ model: { ...model, wanted: true } }),
      SetSlow: ({ on }) => ({ model: { ...model, slow: on } }),
      Arrived: ({ ms }) => ({ model: { ...model, arrivedIn: ms } }),
    }),
  view,
})
