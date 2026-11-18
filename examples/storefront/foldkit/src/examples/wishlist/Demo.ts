import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import { Wishlist } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

// The items alone: a wishlist's `lastMove` may be undefined, which the Flags' JSON can't carry.
const Data = Schema.Struct({ items: Schema.Array(Schema.String) })
// The order my hand has made, from the drag's first step until the store has saved my drop; the
// store's order otherwise.
const Model = Schema.Struct({ items: Schema.Array(Schema.String), mine: Schema.NullOr(Schema.Array(Schema.String)), saving: Schema.Boolean, problem: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  Reordered: { items: Schema.Array(Schema.String) },
  Dropped: { id: Schema.String, values: Schema.Array(Schema.String) },
  Saved: { wishlist: Wishlist },
  Failed: { reason: Schema.String },
  PutBack: {},
})
type Message = typeof Message.Type

/** The piece just before `id` in `values`, or `null` when it's first. */
const pieceBefore = (values: ReadonlyArray<string>, id: string): string | null => {
  const index = values.indexOf(id)
  if (index <= 0) return null
  return values[index - 1] ?? null
}

/** A drop is a move: "put it after this one", saved once a drag, as the drag ends. */
const Move = Command.define("WishlistMove", {
  args: { id: Schema.String, after: Schema.NullOr(Schema.String) },
  messages: [Message.Saved, Message.Failed],
  execute: ({ id, after }) =>
    Shop.use((shop) => shop.moveWishlistItem("mine", id, after)).pipe(
      Effect.map((wishlist) => Message.Saved({ wishlist })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ reason: textOf(error) }))),
    ),
})
const Reset = Command.define("WishlistReset", {
  messages: [Message.Saved, Message.Failed],
  execute: Shop.use((shop) => shop.resetWishlist("mine")).pipe(
    Effect.map((wishlist) => Message.Saved({ wishlist })),
    Effect.catch((error) => Effect.succeed(Message.Failed({ reason: textOf(error) }))),
  ),
})

const orderOf = (model: Model): ReadonlyArray<string> => model.mine ?? model.items

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const order = orderOf(model)
  return h.div([h.Class("wishlist")], [
    h.header([h.Class("wishlist-head")], [h.p([h.Class("muted")], ["Yours alone: rearrange it, then reload the page and it's as you left it."]), h.button([h.Class("button quiet"), h.OnClick(Message.PutBack())], ["Put it back"])]),
    w.ul(
      [h.Class("wish-list"), w.ReorderGroup<string>({ values: order, onReorder: (items) => Message.Reordered({ items }), onReorderEnd: (end) => Message.Dropped({ id: end.value, values: end.values }) })],
      order.map((id) => {
        const product = PRODUCTS.find((one) => one.id === id)
        return w.keyed("li")(id, [h.Class("wish"), h.DataAttribute("id", id), w.ReorderItem(id)], [
          h.img([h.Src(photoOf(id).small), h.Width("56"), h.Height("56"), h.Alt(""), h.Draggable(false)]),
          ...(product === undefined ? [] : [h.span([h.Class("wish-text")], [h.strong([], [product.name]), h.span([h.Class("muted")], [formatPrice(product.price)])])]),
          h.span([h.Class("grip"), h.AriaHidden(true)], ["⋮⋮"]),
        ])
      }),
    ),
    h.div([h.Class("wishlist-foot")], [
      w.div([w.Presence({ initial: false })], model.saving ? [w.keyed("p")("saving", [h.Class("moved-by muted"), w.Initial(fade.initial), w.Animate(fade.animate), w.Exit(fade.exit)], ["Saving…"])] : []),
      ...(model.problem === null ? [] : [h.p([h.Class("error-line"), h.Role("alert")], [model.problem])]),
    ]),
  ])
})

export default definePage({
  id: "wishlist",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.getWishlist("mine")), (wishlist) => ({ items: wishlist.items })),
  init: ({ items }): Model => ({ items, mine: null, saving: false, problem: null }),
  update: (model, message) =>
    Message.match(message, {
      Reordered: ({ items }) => ({ model: { ...model, mine: items } }),
      Dropped: ({ id, values }) => ({ model: { ...model, saving: true, problem: null }, commands: [Move({ id, after: pieceBefore(values, id) })] }),
      Saved: ({ wishlist }) => ({ model: { ...model, items: wishlist.items, mine: null, saving: false } }),
      Failed: ({ reason }) => ({ model: { ...model, mine: null, saving: false, problem: reason } }),
      PutBack: () => ({ model: { ...model, mine: null, saving: true, problem: null }, commands: [Reset()] }),
    }),
  view,
})
