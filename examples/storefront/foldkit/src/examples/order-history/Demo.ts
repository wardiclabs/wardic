import { formatDay, formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import { Order, Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { Wardic } from "@wardic/foldkit"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"

// An order's pieces fade in once its row has started to open, and out quickly as it closes.
const reveal = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { type: "tween", duration: 0.2, delay: 0.1 } },
  exit: { opacity: 0, transition: { type: "tween", duration: 0.1 } },
} as const

const SORTS = { newest: "Newest first", oldest: "Oldest first", total: "Highest total" } as const
const Sort = Schema.Literals(["newest", "oldest", "total"])
type Sort = typeof Sort.Type
const SORT_KEYS: ReadonlyArray<Sort> = ["newest", "oldest", "total"]

/** `orders` in `sort`'s order: they come newest first. */
const sortedBy = (orders: ReadonlyArray<Order>, sort: Sort): ReadonlyArray<Order> => {
  if (sort === "oldest") return [...orders].reverse()
  if (sort === "total") return [...orders].sort((a, b) => b.total - a.total)
  return orders
}

const Data = Schema.Struct({ orders: Schema.Array(Order), products: Schema.Array(Product) })
const Model = Schema.Struct({ orders: Schema.Array(Order), products: Schema.Array(Product), open: Schema.NullOr(Schema.String), sort: Sort })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Toggle: { id: Schema.String }, SortBy: { sort: Sort }, Sorted: {} })
type Message = typeof Message.Type

/**
 * A re-sort moves the orders without resizing any, and nothing else tells them they've moved:
 * declare it, so each one animates from where it is now, inside the scrolled panel too. The Command
 * runs with the Model change that re-sorts them (`Wardic.animateLayout`).
 */
const AnimateSort = Command.define("OrdersAnimateSort", {
  messages: [Message.Sorted],
  execute: Wardic.animateLayout().pipe(
    Effect.as(Message.Sorted()),
    Effect.catch(() => Effect.succeed(Message.Sorted())),
  ),
})

const orderLine = (h: HtmlBuilder<Message>, line: Order["lines"][number], product: Product | undefined): Html =>
  h.li([], [h.img([h.Src(photoOf(line.productId).small), h.Width("40"), h.Height("40"), h.Alt("")]), ...(product === undefined ? [] : [h.span([], [product.name])]), h.span([h.Class("muted")], [`× ${line.quantity}`])])

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const productOf = (id: string): Product | undefined => model.products.find((product) => product.id === id)
  return h.section([h.Class("orders-panel"), h.AriaLabel("Your orders")], [
    h.header([h.Class("orders-head")], [
      h.h2([], ["Your orders"]),
      h.label([h.Class("sort")], [
        h.span([], ["Sort"]),
        h.select([h.OnChange((value) => Message.SortBy({ sort: Schema.is(Sort)(value) ? value : model.sort }))], SORT_KEYS.map((key) => h.option([h.Value(key), h.Selected(model.sort === key)], [SORTS[key]]))),
      ]),
    ]),
    // A scrolling panel: Wardic measures each row where it's drawn, however far the panel has
    // scrolled, so opening one lower down moves the rows below it, and nothing else.
    h.ul(
      [h.Class("orders")],
      sortedBy(model.orders, model.sort).map((order) =>
        w.keyed("li")(order.id, [h.Class("order"), w.Layout()], [
          w.button([h.Class("order-summary"), w.Layout("position"), h.AriaExpanded(model.open === order.id), h.OnClick(Message.Toggle({ id: order.id }))], [
            h.span([h.Class("order-id")], [order.id]),
            h.span([h.Class("order-day")], [formatDay(order.placedOn)]),
            h.span([h.Class("status"), h.DataAttribute("status", order.status)], [order.status]),
            h.span([h.Class("order-total")], [formatPrice(order.total)]),
          ]),
          w.div([w.Presence({ initial: false, mode: "popLayout" })], model.open === order.id ? [w.keyed("ul")("lines", [h.Class("order-lines"), w.Layout("position"), w.Initial(reveal.initial), w.Animate(reveal.animate), w.Exit(reveal.exit)], order.lines.map((line) => orderLine(h, line, productOf(line.productId))))] : []),
        ]),
      ),
    ),
  ])
})

export default definePage({
  id: "order-history",
  Data,
  Model,
  Message,
  load: Effect.all({ orders: Shop.use((shop) => shop.getOrders), products: Shop.use((shop) => shop.listProducts(null)) }),
  init: ({ orders, products }): Model => ({ orders, products, open: null, sort: "newest" }),
  update: (model, message) =>
    Message.match(message, {
      Toggle: ({ id }) => ({ model: { ...model, open: model.open === id ? null : id } }),
      SortBy: ({ sort }) => ({ model: { ...model, sort }, commands: [AnimateSort()] }),
      Sorted: () => ({ model }),
    }),
  view,
})
