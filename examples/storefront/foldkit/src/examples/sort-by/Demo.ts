import { Listbox } from "@foldkit/ui"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Command from "foldkit/command"
import { childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import type * as Update from "foldkit/update"
import { Wardic } from "@wardic/foldkit"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv, type PageReturn } from "~/page.ts"
import { Shop } from "~/shop.ts"

const ORDERS = ["Featured", "Price, low to high", "Price, high to low", "Name"] as const
const Order = Schema.Literals(ORDERS)
type Order = typeof Order.Type

// The library's listbox, bound to the orders: it renders its button and its list, keeps the keyboard
// and the roles, and tells the page the order picked. The list it renders and anchors itself, with a
// Mount of its own, and an element has one Mount on Foldkit: so the list isn't a `w.*` element, and
// grows and shrinks by the stylesheet's transitions on the library's attributes (`data-closed`,
// `data-placement`). The button has no Mount of the library's, so Wardic's reach it through the Bundle.
const Sort = Listbox.create<Order>()

/** `pieces` in `order`: they come featured first. */
const sortedBy = (pieces: ReadonlyArray<Product>, order: Order): ReadonlyArray<Product> => {
  if (order === "Price, low to high") return [...pieces].sort((a, b) => a.price - b.price)
  if (order === "Price, high to low") return [...pieces].sort((a, b) => b.price - a.price)
  if (order === "Name") return [...pieces].sort((a, b) => a.name.localeCompare(b.name))
  return pieces
}

const Data = Schema.Struct({ pieces: Schema.Array(Product) })
const Model = Schema.Struct({ pieces: Schema.Array(Product), order: Order, sort: Listbox.Model })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Sort: { message: Listbox.Message }, Resorted: {} })
type Message = typeof Message.Type

/**
 * A re-sort moves the pieces without resizing any, and nothing else tells them they've moved:
 * declare it, so each slides from where it is to its new place as the list closes (`Wardic.animateLayout`).
 */
const AnimateSort = Command.define("SortAnimateLayout", {
  messages: [Message.Resorted],
  execute: Wardic.animateLayout().pipe(
    Effect.as(Message.Resorted()),
    Effect.catch(() => Effect.succeed(Message.Resorted())),
  ),
})

/** The library's step, folded: its Model kept, its Commands wrapped as the page's, and the order it picked taken, the re-sort declared. */
const folded = (model: Model, step: Update.ReturnWithOutMessage<Listbox.Model, Listbox.Message, Listbox.OutMessage<Order>>): PageReturn<Model, Message> => {
  const commands = Command.mapMessages(step.commands, (message) => Message.Sort({ message }))
  return UndefinedOr.match(step.outMessage, {
    onUndefined: () => ({ model: { ...model, sort: step.model }, commands }),
    onDefined: ({ value }) => ({ model: { ...model, sort: step.model, order: value }, commands: [...commands, AnimateSort()] }),
  })
}

const card = (h: HtmlBuilder<Message>, piece: Product): Html => {
  const w = wardic.html(h)
  const photo = photoOf(piece.id)
  return w.keyed("li")(piece.id, [h.Class("shop-item"), w.Layout()], [
    h.div([h.Class("photo")], [h.img([h.Src(photo.small), h.Srcset(srcsetOf(photo)), h.Sizes("(max-width: 640px) 50vw, 240px"), h.Width(String(photo.width)), h.Height(String(photo.height)), h.Alt(piece.name)])]),
    h.span([h.Class("name")], [piece.name]),
    h.span([h.Class("price")], [formatPrice(piece.price)]),
  ])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return h.div([], [
    h.div([h.Class("sort-head")], [
      h.h2([], ["The shop"]),
      h.submodel({
        slotId: "sort",
        model: model.sort,
        view: Sort.view,
        viewInputs: {
          items: ORDERS,
          maybeSelectedValue: Option.some(model.order),
          itemToConfig: (order) => ({ className: "select-item", content: h.span([], [order]) }),
          ariaLabel: "Sort by",
          buttonClassName: "select-trigger",
          buttonContent: h.span([], [h.span([h.Class("muted")], ["Sort by"]), ` ${model.order} `, h.span([h.AriaHidden(true)], ["⌄"])]),
          // The Bundle, `w.attributes`: Wardic's attributes for an element the library renders, its button's press.
          buttonAttributes: childAttributes(w.attributes({ whileHover: { y: -1 }, whileTap: { scale: 0.97 } })),
          itemsClassName: "select-list",
          // From the button's right edge, where it sits in the head; the stylesheet's transform-origin follows the placement the library writes.
          anchor: { placement: "bottom-end", gap: 6 },
        },
        toParentMessage: (message) => Message.Sort({ message }),
      }),
    ]),
    h.ul([h.Class("shop-items"), h.DataAttribute("view", "grid")], sortedBy(model.pieces, model.order).map((piece) => card(h, piece))),
  ])
})

export default definePage({
  id: "sort-by",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.listProducts(null)), (pieces) => ({ pieces })),
  // Animated by the library: it keeps the list on the page while the stylesheet's transition plays.
  init: ({ pieces }): Model => ({ pieces, order: "Featured", sort: Listbox.init({ id: "sort-by", isAnimated: true }) }),
  update: (model, message) =>
    Message.match(message, {
      Sort: ({ message }) => folded(model, Sort.update(model.sort, message)),
      Resorted: () => ({ model }),
    }),
  view,
})
