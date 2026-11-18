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
import { Shop } from "~/shop.ts"

// The detail view's text fades in once the card has grown into it, and out at once when it closes.
const content = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { delay: 0.15 } },
  exit: { opacity: 0, transition: { type: "tween", duration: 0.1 } },
} as const

const Data = Schema.Struct({ products: Schema.Array(Product) })
const Model = Schema.Struct({ products: Schema.Array(Product), open: Schema.NullOr(Product) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Open: { product: Product }, Close: {} })
type Message = typeof Message.Type

const photo = (h: HtmlBuilder<Message>, product: Product): Html => {
  const w = wardic.html(h)
  const image = photoOf(product.id)
  return w.div([h.Class("photo"), w.LayoutId(`photo-${product.id}`)], [
    h.img([h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("(max-width: 640px) 100vw, 480px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(product.name)]),
  ])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const open = model.open
  return h.div([], [
    h.ul(
      [h.Class("product-grid")],
      model.products.map((product) =>
        h.li([], [
          // Each part of the card has a twin in the detail view: the same layoutId.
          w.button([h.Class("product-card"), w.LayoutId(`card-${product.id}`), h.OnClick(Message.Open({ product })), h.AriaLabel(`Open ${product.name}`)], [
            photo(h, product),
            h.div([h.Class("line")], [
              w.span([h.Class("name"), w.LayoutId(`name-${product.id}`), w.Layout("position")], [product.name]),
              w.span([h.Class("price"), w.LayoutId(`price-${product.id}`), w.Layout("position")], [formatPrice(product.price)]),
            ]),
          ]),
        ]),
      ),
    ),
    // The presence keeps the backdrop while it fades. A presence keeps only its own children: the
    // frame is one, and its own presence propagates the leave to the detail view inside, whose text
    // runs its exit while the frame waits; then the card takes its twins back from where the view was.
    w.div(
      [w.Presence()],
      open === null
        ? []
        : [
            w.keyed("div")("backdrop", [h.Class("backdrop"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Exit({ opacity: 0 }), h.OnClick(Message.Close())]),
            // A position: fixed frame: the twins meet where each is drawn, however far the page has scrolled.
            w.keyed("div")("frame", [h.Class("detail-frame"), w.Presence({ propagate: true })], [
              w.keyed("article")(open.id, [h.Class("detail"), w.LayoutId(`card-${open.id}`), h.Role("dialog"), h.AriaModal(true), h.AriaLabel(open.name)], [
                photo(h, open),
                h.div([h.Class("detail-body")], [
                  w.h2([h.Class("name"), w.LayoutId(`name-${open.id}`), w.Layout("position")], [open.name]),
                  w.p([h.Class("price"), w.LayoutId(`price-${open.id}`), w.Layout("position")], [formatPrice(open.price)]),
                  w.div([h.Class("detail-text"), w.Initial(content.initial), w.Animate(content.animate), w.Exit(content.exit)], [
                    h.p([], [open.description]),
                    h.ul([h.Class("details")], open.details.map((detail) => h.li([], [detail]))),
                    h.button([h.Class("button accent")], ["Add to cart"]),
                  ]),
                ]),
                h.button([h.Class("icon-button close"), h.OnClick(Message.Close()), h.AriaLabel("Close")], ["✕"]),
              ]),
            ]),
          ],
    ),
  ])
})

export default definePage({
  id: "product-detail",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.listProducts(null)), (products) => ({ products })),
  init: ({ products }): Model => ({ products, open: null }),
  update: (model, message) =>
    Message.match(message, {
      Open: ({ product }) => ({ model: { ...model, open: product } }),
      Close: () => ({ model: { ...model, open: null } }),
    }),
  view,
  subscriptions: escapeEntry<Model, Message>("productDetailEscape", (model) => model.open !== null, Message.Close()),
})
