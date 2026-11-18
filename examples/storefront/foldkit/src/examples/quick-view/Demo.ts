import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { escapeEntry } from "~/lib/keys.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

const SHELF = PRODUCTS.filter((product) => ["moon-vase", "celadon-bowl", "cut-carafe"].includes(product.id))

/** Three pieces from other shelves, to go with one. */
const pairingsOf = (piece: Product): ReadonlyArray<Product> => PRODUCTS.filter((other) => other.category !== piece.category).slice(0, 3)

// The suggestions slide in after the panel, and out before it: the panel's exit waits a moment, so
// the list visibly goes first.
const panel = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.97, transition: { type: "tween", duration: 0.2, delay: 0.16 } },
} as const

const pairing = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 26, delay: 0.12 } },
  exit: { opacity: 0, x: -16, transition: { type: "tween", duration: 0.16 } },
} as const

const Data = Schema.Struct({})
// "Not for me" takes a suggestion out of the list, which is why the list is a presence of its own.
const Model = Schema.Struct({ open: Schema.NullOr(Product), dismissed: Schema.Array(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Open: { product: Product }, Close: {}, NotForMe: { id: Schema.String } })
type Message = typeof Message.Type

const body = (model: Model, h: HtmlBuilder<Message>, piece: Product): ReadonlyArray<Html> => {
  const w = wardic.html(h)
  const image = photoOf(piece.id)
  const shown = pairingsOf(piece).filter((other) => !model.dismissed.includes(other.id))
  return [
    h.div([h.Class("photo")], [h.img([h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("200px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(piece.name)])]),
    h.div([h.Class("quick-view-body")], [
      h.h2([h.Class("name")], [piece.name]),
      h.p([h.Class("price")], [formatPrice(piece.price)]),
      h.p([h.Class("muted")], [piece.description]),
      h.h3([], ["Pairs well with"]),
      // propagate: when the dialog goes, these leave first, each running its exit, and the dialog
      // waits for them. Without it, they'd vanish with it.
      w.ul(
        [h.Class("pairings"), w.Presence({ propagate: true })],
        shown.map((other) =>
          w.keyed("li")(other.id, [h.Class("pairing"), w.Layout(), w.Initial(pairing.initial), w.Animate(pairing.animate), w.Exit(pairing.exit)], [
            h.img([h.Src(photoOf(other.id).small), h.Width("40"), h.Height("40"), h.Alt("")]),
            h.span([h.Class("name")], [other.name]),
            h.span([h.Class("price")], [formatPrice(other.price)]),
            h.button([h.Class("icon-button"), h.AriaLabel(`Not for me: ${other.name}`), h.OnClick(Message.NotForMe({ id: other.id }))], ["✕"]),
          ]),
        ),
      ),
    ]),
    h.button([h.Class("icon-button close"), h.OnClick(Message.Close()), h.AriaLabel("Close")], ["✕"]),
  ]
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const open = model.open
  return h.div([], [
    h.ul(
      [h.Class("shelf")],
      SHELF.map((product) => {
        const image = photoOf(product.id)
        return h.li([h.Class("shelf-item")], [
          h.div([h.Class("photo")], [h.img([h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("160px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(product.name)])]),
          h.div([h.Class("line")], [h.span([h.Class("name")], [product.name]), h.span([h.Class("price")], [formatPrice(product.price)])]),
          w.button([h.Class("button quiet"), w.WhileHover({ y: -1 }), w.WhileTap({ scale: 0.96 }), h.OnClick(Message.Open({ product }))], ["Quick view"]),
        ])
      }),
    ),
    // A presence keeps only its own children: the frame is one, and its own presence propagates the
    // leave to the dialog inside, which runs its exit while the frame waits.
    w.div(
      [w.Presence()],
      open === null
        ? []
        : [
            w.keyed("div")("backdrop", [h.Class("backdrop"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Exit({ opacity: 0, transition: { delay: 0.16 } }), h.OnClick(Message.Close())]),
            w.keyed("div")("frame", [h.Class("detail-frame"), w.Presence({ propagate: true })], [
              w.keyed("article")(open.id, [h.Class("quick-view"), h.Role("dialog"), h.AriaModal(true), h.AriaLabel(open.name), w.Initial(panel.initial), w.Animate(panel.animate), w.Exit(panel.exit)], body(model, h, open)),
            ]),
          ],
    ),
  ])
})

export default definePage({
  id: "quick-view",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ open: null, dismissed: [] }),
  update: (model, message) =>
    Message.match(message, {
      Open: ({ product }) => ({ model: { ...model, open: product, dismissed: [] } }),
      Close: () => ({ model: { ...model, open: null } }),
      NotForMe: ({ id }) => ({ model: { ...model, dismissed: [...model.dismissed, id] } }),
    }),
  view,
  subscriptions: escapeEntry<Model, Message>("quickViewEscape", (model) => model.open !== null, Message.Close()),
})
