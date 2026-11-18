import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import { Cart, type CartLine, Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { escapeEntry } from "~/lib/keys.ts"
import { wardic } from "~/lib/wardic.ts"
import { cartChanged, definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

const SUGGESTED = ["white-bowl", "celadon-bowl", "slip-dish", "painted-jug"]

// The drawer slides in from the right edge; a line arrives from the right and leaves the same way.
const drawer = { initial: { x: 460 }, animate: { x: 0 }, exit: { x: 460 }, transition: { type: "spring", stiffness: 380, damping: 40 } } as const
const line = { initial: { opacity: 0, x: 32 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 32 } } as const
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

/** A change on its way to the store: laid over the server's cart until the store answers. */
const Pending = Schema.Struct({ token: Schema.Number, kind: Schema.Literals(["add", "set"]), productId: Schema.String, quantity: Schema.Number })
type Pending = typeof Pending.Type

const Data = Schema.Struct({ cart: Cart, products: Schema.Array(Product) })
const Model = Schema.Struct({ cart: Cart, products: Schema.Array(Product), open: Schema.Boolean, pending: Schema.Array(Pending), next: Schema.Number, problem: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  Open: {},
  Close: {},
  Add: { productId: Schema.String },
  Change: { productId: Schema.String, quantity: Schema.Number },
  Answered: { token: Schema.Number, cart: Cart },
  Failed: { token: Schema.Number, reason: Schema.String },
})
type Message = typeof Message.Type

const Send = Command.define("CartDrawerSend", {
  args: { change: Pending },
  messages: [Message.Answered, Message.Failed],
  execute: ({ change }) =>
    Shop.use((shop) => (change.kind === "add" ? shop.addToCart(change.productId, change.quantity) : shop.setCartQuantity(change.productId, change.quantity))).pipe(
      Effect.map((cart) => Message.Answered({ token: change.token, cart })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ token: change.token, reason: textOf(error) }))),
    ),
})

/** `lines` with `quantity` more of a product: its line, or a new one at the end. */
const withAdded = (lines: ReadonlyArray<CartLine>, productId: string, quantity: number): ReadonlyArray<CartLine> => {
  if (lines.some((one) => one.productId === productId)) return withQuantity(lines, productId, quantityIn(lines, productId) + quantity)
  return [...lines, { productId, quantity }]
}

/** `lines` with a product's line at `quantity`, capped at 99; gone at 0. */
const withQuantity = (lines: ReadonlyArray<CartLine>, productId: string, quantity: number): ReadonlyArray<CartLine> =>
  lines.map((one) => (one.productId === productId ? { productId, quantity: Math.min(quantity, 99) } : one)).filter((one) => one.quantity > 0)

const quantityIn = (lines: ReadonlyArray<CartLine>, productId: string): number => lines.filter((one) => one.productId === productId).reduce((sum, one) => sum + one.quantity, 0)

/** The cart as it's about to be: the server's, with the changes still on their way laid over it, so a line moves the moment it's tapped. */
const linesOf = (model: Model): ReadonlyArray<CartLine> =>
  model.pending.reduce((lines, change) => (change.kind === "add" ? withAdded(lines, change.productId, change.quantity) : withQuantity(lines, change.productId, change.quantity)), model.cart.lines)

const productOf = (model: Model, id: string): Product | undefined => model.products.find((product) => product.id === id)

const cartLine = (model: Model, h: HtmlBuilder<Message>, id: string): Html => {
  const w = wardic.html(h)
  const product = productOf(model, id)
  const quantity = quantityIn(linesOf(model), id)
  return w.keyed("li")(id, [h.Class("cart-line"), w.Layout(), w.Initial(line.initial), w.Animate(line.animate), w.Exit(line.exit)], product === undefined ? [] : [
    h.img([h.Src(photoOf(id).small), h.Width("56"), h.Height("56"), h.Alt("")]),
    h.div([h.Class("cart-line-text")], [h.strong([], [product.name]), h.span([h.Class("muted")], [formatPrice(product.price)])]),
    h.div([h.Class("stepper"), h.Role("group"), h.AriaLabel(`${product.name} quantity`)], [
      h.button([h.AriaLabel("One fewer"), h.OnClick(Message.Change({ productId: id, quantity: quantity - 1 }))], ["−"]),
      h.span([], [String(quantity)]),
      h.button([h.AriaLabel("One more"), h.OnClick(Message.Change({ productId: id, quantity: quantity + 1 }))], ["+"]),
    ]),
    h.button([h.Class("link-button"), h.OnClick(Message.Change({ productId: id, quantity: 0 }))], ["Remove"]),
  ])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const lines = linesOf(model)
  const ids = lines.map((one) => one.productId)
  const count = lines.reduce((sum, one) => sum + one.quantity, 0)
  const subtotal = lines.reduce((sum, one) => sum + one.quantity * (productOf(model, one.productId)?.price ?? 0), 0)
  const suggestions = SUGGESTED.filter((id) => !ids.includes(id))
  return h.div([h.Class("cart-demo")], [
    h.p([h.Class("muted")], ["Your cart lives on the store: what you add here is in the header's cart too."]),
    h.button([h.Class("button accent open-cart"), h.OnClick(Message.Open())], [`Open the cart · ${count}`]),
    w.div(
      [w.Presence()],
      !model.open
        ? []
        : [
            w.keyed("div")("backdrop", [h.Class("backdrop"), w.Initial(fade.initial), w.Animate(fade.animate), w.Exit(fade.exit), h.OnClick(Message.Close())]),
            w.keyed("aside")("drawer", [h.Class("drawer"), h.Role("dialog"), h.AriaModal(true), h.AriaLabel("Your cart"), w.Initial(drawer.initial), w.Animate(drawer.animate), w.Exit(drawer.exit), w.Transition(drawer.transition)], [
              h.header([h.Class("drawer-head")], [h.h2([], ["Your cart"]), h.button([h.Class("icon-button"), h.AriaLabel("Close"), h.OnClick(Message.Close())], ["✕"])]),
              h.div([h.Class("drawer-body")], [
                // Each line is a layout element: when one goes, popLayout takes it out of the flow
                // at once, and the lines below slide up into its place while it fades.
                w.ul([h.Class("cart-lines"), w.Presence({ mode: "popLayout", initial: false })], ids.map((id) => cartLine(model, h, id))),
                w.div([w.Presence({ initial: false })], ids.length === 0 ? [w.keyed("p")("empty", [h.Class("cart-empty"), w.Initial(fade.initial), w.Animate(fade.animate), w.Exit(fade.exit)], ["Your cart is empty."])] : []),
                // The suggestions sit under the lines and slide down as lines arrive: Layout("position"),
                // as their block only travels. One added to the cart leaves, and the rest close up.
                ...(suggestions.length === 0
                  ? []
                  : [
                      w.section([h.Class("suggestions"), w.Layout("position")], [
                        h.h3([], ["You might also like"]),
                        w.ul(
                          [w.Presence({ mode: "popLayout", initial: false })],
                          suggestions.map((id) => {
                            const product = productOf(model, id)
                            return w.keyed("li")(id, [w.Layout("position"), w.Initial(fade.initial), w.Animate(fade.animate), w.Exit(fade.exit)], product === undefined ? [] : [
                              h.button([h.Class("suggestion"), h.OnClick(Message.Add({ productId: id }))], [
                                h.img([h.Src(photoOf(id).small), h.Width("44"), h.Height("44"), h.Alt("")]),
                                h.span([], [product.name]),
                                h.span([h.Class("add"), h.AriaHidden(true)], ["+"]),
                              ]),
                            ])
                          }),
                        ),
                      ]),
                    ]),
                ...(model.problem === null ? [] : [h.p([h.Class("error-line"), h.Role("alert")], [model.problem])]),
              ]),
              h.footer([h.Class("drawer-foot")], [h.span([], ["Subtotal"]), h.strong([], [formatPrice(subtotal)]), h.button([h.Class("button accent"), h.Disabled(ids.length === 0)], ["Check out"])]),
            ]),
          ],
    ),
  ])
})

/** A change queued: laid over the cart at once, and sent. */
const queued = (model: Model, kind: Pending["kind"], productId: string, quantity: number) => {
  const change: Pending = { token: model.next, kind, productId, quantity }
  return { model: { ...model, pending: [...model.pending, change], next: model.next + 1, problem: null }, commands: [Send({ change })] }
}

export default definePage({
  id: "cart-drawer",
  Data,
  Model,
  Message,
  load: Effect.all({ cart: Shop.use((shop) => shop.getCart), products: Shop.use((shop) => shop.listProducts(undefined)) }),
  init: ({ cart, products }): Model => ({ cart, products, open: false, pending: [], next: 1, problem: null }),
  update: (model, message) =>
    Message.match(message, {
      Open: () => ({ model: { ...model, open: true } }),
      Close: () => ({ model: { ...model, open: false } }),
      Add: ({ productId }) => queued(model, "add", productId, 1),
      Change: ({ productId, quantity }) => queued(model, "set", productId, quantity),
      Answered: ({ token, cart }) => ({ model: { ...model, cart, pending: model.pending.filter((one) => one.token !== token) }, outMessage: cartChanged(cart) }),
      Failed: ({ token, reason }) => ({ model: { ...model, pending: model.pending.filter((one) => one.token !== token), problem: reason } }),
    }),
  view,
  subscriptions: escapeEntry<Model, Message>("cartDrawerEscape", (model) => model.open, Message.Close()),
})
