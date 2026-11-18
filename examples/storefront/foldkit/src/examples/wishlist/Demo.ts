import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import { type Product, WishlistMove } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import * as Subscription from "foldkit/subscription"
import { problemLine } from "~/lib/view.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Listing, Shop } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

const Data = Schema.Struct({ wishlist: Listing })
// The list as the store has it, live: its order now, then each move anyone makes, as the feed
// brings it; the order my hands have made of it (the group's `onReorder`, by pointer or by keys),
// from a hold's start until the store has my drop; and the piece in my hand, from a hold's start to
// its end.
const Model = Schema.Struct({
  items: Schema.Array(Schema.String),
  version: Schema.Int,
  lastMove: Schema.NullOr(WishlistMove),
  mine: Schema.NullOr(Schema.Array(Schema.String)),
  held: Schema.NullOr(Schema.String),
  saving: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
})
type Model = typeof Model.Type
const Message = defineMessageUnion({
  HoldStart: { id: Schema.String },
  HoldEnd: {},
  Reordered: { items: Schema.Array(Schema.String) },
  Dropped: { id: Schema.String, values: Schema.Array(Schema.String) },
  Saved: { wishlist: Listing },
  Changed: { wishlist: Listing },
  Failed: { reason: Schema.String },
  PutBack: {},
})
type Message = typeof Message.Type

/** The piece just before `id` in `values`, or `null` when it's first. */
const pieceBefore = (values: ReadonlyArray<string>, id: string): string | null => {
  const index = values.indexOf(id)
  if (index <= 0) return null
  return values[index - 1]
}

// A drop is a move: "put it after this one", which the store applies to its order as it is then,
// so it means the same whatever others moved meanwhile. My order shows until the feed has it.
const Move = Command.define("WishlistMove", {
  args: { id: Schema.String, after: Schema.NullOr(Schema.String) },
  messages: [Message.Saved, Message.Failed],
  execute: ({ id, after }) =>
    Shop.use((shop) => shop.moveWishlistItem("shared", id, after)).pipe(
      Effect.map((wishlist) => Message.Saved({ wishlist })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ reason: textOf(error) }))),
    ),
})
const Reset = Command.define("WishlistReset", {
  messages: [Message.Saved, Message.Failed],
  execute: Shop.use((shop) => shop.resetWishlist("shared")).pipe(
    Effect.map((wishlist) => Message.Saved({ wishlist })),
    Effect.catch((error) => Effect.succeed(Message.Failed({ reason: textOf(error) }))),
  ),
})

// The feed: the store's order again each time anyone moves a piece, as a Subscription that lives
// while the page does, no Model change restarting it. Solid 2 reads a `live()` server function;
// on Foldkit the stream is the Shop's, a streaming rpc over the store's own `Stream`.
const subscriptions = Subscription.make<Model, Message, Shop>()(() => ({
  wishlistFeed: Subscription.persistentEntry(
    Stream.unwrap(Shop.use((shop) => Effect.succeed(shop.wishlistChanges("shared")))).pipe(
      Stream.map((wishlist) => Message.Changed({ wishlist })),
      Stream.catchCause((cause) => Stream.make(Message.Failed({ reason: `The feed stopped: ${String(cause)}` }))),
    ),
  ),
}))

/**
 * `server`'s order, with `id` just after the piece above it in `local`, or first if none is: `local`
 * itself when that's the same order. A keyboard lift ends when the group's values change to any
 * other array than the one it handed out (ADR-0037), so an unchanged order must be the same array.
 */
const withHeldAt = (server: ReadonlyArray<string>, local: ReadonlyArray<string>, id: string): ReadonlyArray<string> => {
  const others = server.filter((one) => one !== id)
  const above = local
    .slice(0, local.indexOf(id))
    .filter((one) => others.includes(one))
    .at(-1)
  const merged = placedAfter(others, above, id)
  if (sameOrder(merged, local)) return local
  return merged
}

/** `others` with `id` just after `above`, or first without one. */
const placedAfter = (others: ReadonlyArray<string>, above: string | undefined, id: string): ReadonlyArray<string> => {
  if (above === undefined) return [id, ...others]
  const at = others.indexOf(above) + 1
  return [...others.slice(0, at), id, ...others.slice(at)]
}

const sameOrder = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => a.length === b.length && a.every((one, i) => one === b[i])

// Yours stays yours: while I hold a piece, dragged or lifted with the keys, the list is everyone
// else's order, kept live, with my piece where my hands have it. Another visitor's move ends a
// keyboard lift there (a group drops a lift when its values change), and saves it where it is.
const orderOf = (model: Model): ReadonlyArray<string> => {
  const local = model.mine ?? model.items
  if (model.held === null) return local
  return withHeldAt(model.items, local, model.held)
}

const productOf = (id: string): Product | undefined => PRODUCTS.find((product) => product.id === id)
const nameOf = (id: string): string => productOf(id)?.name ?? id

const view = defineView<Model, Message, PageEnv>((model, env, h) => {
  const w = wardic.html(h)
  const order = orderOf(model)
  const who = (name: string): string => (name === env.visitorName ? "You" : name)
  return h.div([h.Class("wishlist")], [
    h.header([h.Class("wishlist-head")], [
      h.p([h.Class("muted")], ["Shared by everyone who opens this page. You're ", h.strong([], [env.visitorName]), ": open it in a private window too, and rearrange it in both."]),
      h.button([h.Class("button quiet"), h.OnClick(Message.PutBack())], ["Put it back"]),
    ]),
    // The group tells each hold's start and end, and each reorder, as Messages; the order lives in the Model.
    w.ul(
      [
        h.Class("wish-list"),
        w.ReorderGroup<string>({
          values: order,
          onReorder: (items) => Message.Reordered({ items }),
          onReorderEnd: (end) => Message.Dropped({ id: end.value, values: end.values }),
          onHoldStart: (start) => Message.HoldStart({ id: start.value }),
          onHoldEnd: () => Message.HoldEnd(),
        }),
      ],
      order.map((id) => {
        const product = productOf(id)
        return w.keyed("li")(id, [h.Class("wish"), h.DataAttribute("id", id), w.ReorderItem(id)], [
          h.img([h.Src(photoOf(id).small), h.Width("56"), h.Height("56"), h.Alt(""), h.Draggable(false)]),
          ...(product === undefined ? [] : [h.span([h.Class("wish-text")], [h.strong([], [product.name]), h.span([h.Class("muted")], [formatPrice(product.price)])])]),
          h.span([h.Class("grip"), h.AriaHidden(true)], ["⋮⋮"]),
        ])
      }),
    ),
    h.div([h.Class("wishlist-foot")], [
      w.div([w.Presence({ initial: false })], model.lastMove === null ? [] : [w.keyed("p")(`${model.lastMove.by}-${model.lastMove.productId}-${model.version}`, [h.Class("moved-by muted"), w.Initial(fade.initial), w.Animate(fade.animate), w.Exit(fade.exit)], [`${who(model.lastMove.by)} moved the ${nameOf(model.lastMove.productId)}.`])]),
      ...problemLine(h, model.problem),
    ]),
  ])
})

/** The store's list, from the feed or an answer: mine lets go once the store has my drop. */
const taking = (model: Model, wishlist: Listing): Model => ({
  ...model,
  items: wishlist.items,
  version: wishlist.version,
  lastMove: wishlist.lastMove,
  mine: model.saving ? model.mine : null,
})

export default definePage({
  id: "wishlist",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.getWishlist("shared")), (wishlist) => ({ wishlist })),
  init: ({ wishlist }): Model => ({ items: wishlist.items, version: wishlist.version, lastMove: wishlist.lastMove, mine: null, held: null, saving: false, problem: null }),
  update: (model, message) =>
    Message.match(message, {
      HoldStart: ({ id }) => ({ model: { ...model, mine: orderOf(model), held: id } }),
      HoldEnd: () => ({ model: { ...model, held: null, mine: model.saving ? model.mine : null } }),
      Reordered: ({ items }) => ({ model: { ...model, mine: items } }),
      Dropped: ({ id, values }) => ({ model: { ...model, mine: values, saving: true, problem: null }, commands: [Move({ id, after: pieceBefore(values, id) })] }),
      // My drop is in the store: my order shows until the feed has caught up with its version.
      Saved: ({ wishlist }) => ({ model: { ...taking({ ...model, saving: false }, wishlist), mine: model.version >= wishlist.version ? null : model.mine } }),
      Changed: ({ wishlist }) => ({ model: taking(model, wishlist) }),
      Failed: ({ reason }) => ({ model: { ...model, mine: null, saving: false, problem: reason } }),
      PutBack: () => ({ model: { ...model, mine: null, saving: true, problem: null }, commands: [Reset()] }),
    }),
  view,
  subscriptions,
})
