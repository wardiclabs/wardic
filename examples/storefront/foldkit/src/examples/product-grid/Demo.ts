import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"

// The grid names a variant; each card under it follows, delayed by its place.
const grid = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}

const card = {
  hidden: { opacity: 0, y: 24 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 240, damping: 24 } },
} as const

// Under the pointer the card lifts, and its photo eases in. A target, not a variant name: a name in
// `WhileHover` would make the card a variant controller of its own, as in Motion, and it would no
// longer follow the grid's `Initial` and `Animate`, so it would neither enter nor stagger. The photo
// hears the hover as a Message instead, and the Model says which card is under the pointer.
const lift = { y: -4, transition: { type: "spring", stiffness: 400, damping: 28 } } as const

/** The photo's scale, by whether its card is under the pointer. */
const ZOOM = { hovered: { scale: 1.05 }, rested: { scale: 1 } } as const

const Data = Schema.Struct({ products: Schema.Array(Product) })
const Model = Schema.Struct({ products: Schema.Array(Product), hovered: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ HoverStart: { id: Schema.String }, HoverEnd: { id: Schema.String } })
type Message = typeof Message.Type

const zoomOf = (model: Model, id: string) => (model.hovered === id ? ZOOM.hovered : ZOOM.rested)

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return w.ul(
    [h.Class("product-grid"), w.Variants(grid), w.Initial("hidden"), w.Animate("shown")],
    model.products.map((product) => {
      const image = photoOf(product.id)
      return w.keyed("li")(product.id, [h.Class("product-card"), w.Variants(card), w.WhileHover(lift), w.OnHoverStart(Message.HoverStart({ id: product.id })), w.OnHoverEnd(Message.HoverEnd({ id: product.id }))], [
        h.div([h.Class("photo")], [
          w.img([w.Animate(zoomOf(model, product.id)), h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("(max-width: 640px) 50vw, 240px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(product.name)]),
        ]),
        h.div([h.Class("line")], [h.span([h.Class("name")], [product.name]), h.span([h.Class("price")], [formatPrice(product.price)])]),
        h.p([h.Class("tagline")], [product.tagline]),
      ])
    }),
  )
})

export default definePage({
  id: "product-grid",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.listProducts(undefined)), (products) => ({ products })),
  init: ({ products }): Model => ({ products, hovered: null }),
  update: (model, message) =>
    Message.match(message, {
      HoverStart: ({ id }) => ({ model: { ...model, hovered: id } }),
      HoverEnd: ({ id }) => ({ model: { ...model, hovered: model.hovered === id ? null : model.hovered } }),
    }),
  view,
})
