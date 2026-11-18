import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { Cart } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { cartChanged, definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

const Kind = Schema.Literals(["added", "failed"])
const Toast = Schema.Struct({ id: Schema.Number, kind: Kind, text: Schema.String })
type Toast = typeof Toast.Type

// A toast rises in at the bottom of the stack and shrinks away as it goes. Each is a layout
// element: when one goes, the presence pops it out of the stack (mode: "popLayout"), and the others
// slide into its place while it fades. The stack sits in its corner, so one that goes is pinned by
// its bottom right (anchorX, anchorY): if the stack resizes as it goes, it stays in the corner.
const toastMotion = {
  initial: { opacity: 0, y: 24, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.9, transition: { type: "tween", duration: 0.18 } },
  transition: { type: "spring", stiffness: 420, damping: 32 },
} as const

const SHELF = PRODUCTS.filter((product) => ["moon-vase", "celadon-bowl", "poppy-plate"].includes(product.id))

/** How long a toast stays, and how many show at once: a fourth pushes the oldest out. */
const STAYS_MS = 4000
const AT_MOST = 3

const Data = Schema.Struct({})
const Model = Schema.Struct({ toasts: Schema.Array(Toast), next: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Buy: { id: Schema.String, name: Schema.String }, Added: { name: Schema.String, cart: Cart }, Failed: { name: Schema.String, reason: Schema.String }, Dismiss: { id: Schema.Number } })
type Message = typeof Message.Type

const Add = Command.define("ToastsAdd", {
  args: { id: Schema.String, name: Schema.String },
  messages: [Message.Added, Message.Failed],
  execute: ({ id, name }) =>
    Shop.use((shop) => shop.addToCart(id, 1)).pipe(
      Effect.map((cart) => Message.Added({ name, cart })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ name, reason: textOf(error) }))),
    ),
})
const Expire = Command.define("ToastsExpire", { args: { id: Schema.Number }, messages: [Message.Dismiss], execute: ({ id }) => Effect.sleep(STAYS_MS).pipe(Effect.as(Message.Dismiss({ id }))) })

/** A toast shown: at the bottom of the stack, the oldest pushed out past three, expiring in its time. */
const shown = (model: Model, kind: Toast["kind"], text: string) => {
  const toast: Toast = { id: model.next, kind, text }
  return { model: { ...model, toasts: [...model.toasts, toast].slice(-AT_MOST), next: model.next + 1 }, commands: [Expire({ id: toast.id })] }
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return h.div([h.Class("toast-demo")], [
    h.ul(
      [h.Class("shelf")],
      SHELF.map((product) => {
        const image = photoOf(product.id)
        return h.li([h.Class("shelf-item")], [
          h.div([h.Class("photo")], [h.img([h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("160px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(product.name)])]),
          h.div([h.Class("line")], [h.span([h.Class("name")], [product.name]), h.span([h.Class("price")], [formatPrice(product.price)])]),
          w.button([h.Class("button quiet"), w.WhileHover({ y: -1 }), w.WhileTap({ scale: 0.96 }), h.OnClick(Message.Buy({ id: product.id, name: product.name }))], ["Add to cart"]),
        ])
      }),
    ),
    w.ol(
      [h.Class("toasts"), h.AriaLive("polite"), h.AriaLabel("Notifications"), w.Presence({ mode: "popLayout", anchorX: "right", anchorY: "bottom" })],
      model.toasts.map((toast) =>
        w.keyed("li")(String(toast.id), [h.Class("toast"), h.DataAttribute("kind", toast.kind), w.Layout(), w.Initial(toastMotion.initial), w.Animate(toastMotion.animate), w.Exit(toastMotion.exit), w.Transition(toastMotion.transition)], [
          h.span([], [toast.text]),
          h.button([h.Class("icon-button"), h.AriaLabel("Dismiss"), h.OnClick(Message.Dismiss({ id: toast.id }))], ["✕"]),
        ]),
      ),
    ),
  ])
})

export default definePage({
  id: "toasts",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ toasts: [], next: 1 }),
  update: (model, message) =>
    Message.match(message, {
      Buy: ({ id, name }) => ({ model, commands: [Add({ id, name })] }),
      Added: ({ name, cart }) => ({ ...shown(model, "added", `${name} is in your cart.`), outMessage: cartChanged(cart) }),
      Failed: ({ name, reason }) => shown(model, "failed", `${name} wasn't added: ${reason}`),
      Dismiss: ({ id }) => ({ model: { ...model, toasts: model.toasts.filter((toast) => toast.id !== id) } }),
    }),
  view,
})
