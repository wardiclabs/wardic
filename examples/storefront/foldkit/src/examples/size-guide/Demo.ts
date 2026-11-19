import { Dialog } from "@foldkit/ui"
import { Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import type * as Update from "foldkit/update"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv, type PageReturn } from "~/page.ts"
import { Shop } from "~/shop.ts"

const shade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { type: "tween", duration: 0.2 },
} as const

// The guide rises a little as it fades in, and sinks back, quicker, as it goes.
const rise = {
  initial: { opacity: 0, y: 24, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 12, scale: 0.98, transition: { type: "tween", duration: 0.15 } },
  transition: { type: "spring", stiffness: 380, damping: 32 },
} as const

const Data = Schema.Struct({ pieces: Schema.Array(Product) })
// The library's dialog beside the page's own `showing`: the guide is shown while Wardic has it on
// the page, which outlasts a close request by its exit.
const Model = Schema.Struct({ pieces: Schema.Array(Product), dialog: Dialog.Model, showing: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Open: {}, Dialog: { message: Dialog.Message }, Gone: {} })
type Message = typeof Message.Type

/** The library's step, folded: its Model kept, its Commands wrapped as the page's Messages. */
const folded = (model: Model, step: Update.ReturnWithOutMessage<Dialog.Model, Dialog.Message, Dialog.OutMessage>, showing: boolean): PageReturn<Model, Message> => ({
  model: { ...model, dialog: step.model, showing },
  commands: Command.mapMessages(step.commands, (message) => Message.Dialog({ message })),
})

/**
 * The guide, from the attributes the library hands its `toView`, spread onto the page's own elements:
 * the native dialog it opens, locks the page's scroll under and traps focus in; the shade that
 * closes it; the panel; its title and description, wired to the dialog's labelling; its ✕.
 */
const guide = (model: Model, h: HtmlBuilder<Message>, render: Dialog.RenderInfo): Html => {
  const w = wardic.html(h)
  return h.dialog([...render.dialog, h.Class("size-guide-dialog")], [
    // The library keeps its dialog open until the page says so: the presence keeps the shade and
    // the guide on the page while their exits play, then Gone closes it.
    w.div(
      [w.Presence({ onExitComplete: Message.Gone() })],
      model.showing
        ? [
            w.keyed("div")("shade", [...render.backdrop, h.Class("backdrop"), w.Initial(shade.initial), w.Animate(shade.animate), w.Exit(shade.exit), w.Transition(shade.transition)]),
            w.keyed("div")("guide", [...render.panel, h.Class("size-guide"), w.Initial(rise.initial), w.Animate(rise.animate), w.Exit(rise.exit), w.Transition(rise.transition)], [
              h.header([], [h.h2([...render.title], ["Size guide"]), h.button([...render.closeButton, h.Class("icon-button"), h.AriaLabel("Close")], ["✕"])]),
              h.p([...render.description, h.Class("muted")], ["Height × width, or across for plates and bowls."]),
              h.table([h.Class("size-table")], [h.tbody([], model.pieces.map((piece) => h.tr([], [h.th([h.Attribute("scope", "row")], [piece.name]), h.td([], [piece.details[0]])])))]),
            ]),
          ]
        : [],
    ),
  ])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return h.div([], [
    w.button([h.Class("button size-guide-button"), w.WhileHover({ y: -1 }), w.WhileTap({ scale: 0.96 }), h.OnClick(Message.Open())], ["Size guide"]),
    h.submodel({ slotId: "size-guide", model: model.dialog, view: Dialog.view, viewInputs: { hasDescription: true, toView: (render) => guide(model, h, render) }, toParentMessage: (message) => Message.Dialog({ message }) }),
  ])
})

export default definePage({
  id: "size-guide",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.listProducts(null)), (pieces) => ({ pieces })),
  // Not animated by the library: Wardic plays the shade's and the guide's entrances and exits.
  init: ({ pieces }): Model => ({ pieces, dialog: Dialog.init({ id: "size-guide", isAnimated: false }), showing: false }),
  update: (model, message) =>
    Message.match(message, {
      Open: () => folded(model, Dialog.open(model.dialog), true),
      Dialog: ({ message }) => {
        // Escape, a click on the shade or ✕ asks the library to close: the page lets the exits play first.
        if (message._tag === "RequestedClose") return { model: { ...model, showing: false } }
        return folded(model, Dialog.update(model.dialog, message), model.showing)
      },
      Gone: () => folded(model, Dialog.close(model.dialog), false),
    }),
  view,
})
