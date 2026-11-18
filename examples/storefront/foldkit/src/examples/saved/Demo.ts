import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { Cart, Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { arrivalId } from "~/lib/arrivals.ts"
import { problemLine } from "~/lib/view.ts"
import { wardic } from "~/lib/wardic.ts"
import { arriving, cartChanged, definePage, type PageEnv, recalled } from "~/page.ts"
import { Shop } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

const SAVED = PRODUCTS.filter((product) => ["bottle-vase", "tulip-bowl", "painted-jug", "cut-carafe"].includes(product.id))

const Data = Schema.Struct({})
const Model = Schema.Struct({ saved: Schema.Array(Product), failure: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Move: { product: Product }, Remove: { id: Schema.String }, Moved: { id: Schema.String, cart: Cart }, Refused: { product: Product, reason: Schema.String }, SaveAgain: {} })
type Message = typeof Message.Type

const AddOne = Command.define("SavedAddOne", {
  args: { product: Product },
  messages: [Message.Moved, Message.Refused],
  execute: ({ product }) =>
    Shop.use((shop) => shop.addToCart(product.id, 1)).pipe(
      Effect.map((cart) => Message.Moved({ id: product.id, cart })),
      Effect.catch((error) => Effect.succeed(Message.Refused({ product, reason: textOf(error) }))),
    ),
})

/** Back in its place: the saved pieces in their order, it among them. */
const putBack = (saved: ReadonlyArray<Product>, piece: Product): ReadonlyArray<Product> => SAVED.filter((one) => one.id === piece.id || saved.some((kept) => kept.id === one.id))

const savedRow = (h: HtmlBuilder<Message>, piece: Product): Html => {
  const w = wardic.html(h)
  const image = photoOf(piece.id)
  // It fades as it leaves, either way. Moved to the cart, its photo's twin there flies from its own.
  return w.keyed("li")(piece.id, [h.Class("saved-row"), w.Layout(), w.Exit({ opacity: 0, transition: { type: "tween", duration: 0.22, ease: "easeOut" } })], [
    // One photo flies, not two crossfading: this and its twin in the cart button both have
    // LayoutCrossfade(false), so whichever takes over hides the other, out to the cart and back.
    w.div([h.Class("photo"), w.LayoutId(arrivalId(piece.id)), w.LayoutCrossfade(false)], [
      h.img([h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("72px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(piece.name)]),
    ]),
    h.div([h.Class("saved-text")], [h.span([h.Class("name")], [piece.name]), h.span([h.Class("price")], [formatPrice(piece.price)])]),
    h.div([h.Class("saved-actions")], [
      w.button([h.Class("button accent"), w.WhileTap({ scale: 0.96 }), h.OnClick(Message.Move({ product: piece }))], ["Move to cart"]),
      h.button([h.Class("button quiet"), h.OnClick(Message.Remove({ id: piece.id }))], ["Remove"]),
    ]),
  ])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return h.div([h.Class("saved")], [
    // popLayout: a leaving row steps out of the list at once, and the rows below close the gap while it goes.
    w.ul([h.Class("saved-list"), w.Presence({ mode: "popLayout" })], model.saved.map((piece) => savedRow(h, piece))),
    ...(model.saved.length === 0 ? [h.p([h.Class("saved-empty muted")], ["Nothing saved for later. ", h.button([h.Class("button quiet"), h.OnClick(Message.SaveAgain())], ["Save them again"])])] : []),
    ...problemLine(h, model.failure),
  ])
})

export default definePage({
  id: "saved",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ saved: SAVED, failure: null }),
  update: (model, message, env) =>
    Message.match(message, {
      // A click takes its row out at once, its photo's twin appearing in the cart button in the same
      // update, so Wardic flies it there (under reduced motion, nothing flies); if the store refuses,
      // the row comes back. A piece already on its way, its leaving row clicked again, is left alone.
      Move: ({ product }) => {
        if (!model.saved.some((one) => one.id === product.id)) return { model }
        const taken = { ...model, saved: model.saved.filter((one) => one.id !== product.id), failure: null }
        if (env.reduceMotion) return { model: taken, commands: [AddOne({ product })] }
        return { model: taken, commands: [AddOne({ product })], outMessage: arriving(product.id, photoOf(product.id).small) }
      },
      Remove: ({ id }) => ({ model: { ...model, saved: model.saved.filter((one) => one.id !== id) } }),
      Moved: ({ cart }) => ({ model, outMessage: cartChanged(cart) }),
      // Refused: its row back, and its twin leaving the cart button, its photo flying back.
      Refused: ({ product, reason }) => ({ model: { ...model, saved: putBack(model.saved, product), failure: `${product.name} wasn't moved: ${reason}` }, outMessage: recalled(product.id) }),
      SaveAgain: () => ({ model: { ...model, saved: SAVED } }),
    }),
  view,
})
