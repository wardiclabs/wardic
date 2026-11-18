import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf } from "@wardic/example-storefront-shared/images"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Shop, StockWhen } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

/** A shelf holds eight of a piece: a full meter. */
const SHELF = 8

const PIECES = PRODUCTS.filter((product) => ["blossom-jar", "bottle-vase", "tulip-bowl", "lagoon-vase"].includes(product.id))

const FILL = { type: "spring", stiffness: 140, damping: 22 } as const

const Levels = Schema.Record(Schema.String, Schema.Number)
const Data = Schema.Struct({ levels: Levels })
// Each piece's count, from the store; `checking` while the next count is on its way, the bars kept
// meanwhile, as Solid's transition keeps them; `filling` for each bar between its start and its landing.
const Model = Schema.Struct({ when: StockWhen, levels: Levels, checking: Schema.Boolean, filling: Schema.Array(Schema.String), problem: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  Choose: { when: StockWhen },
  Counted: { when: StockWhen, levels: Levels },
  Failed: { reason: Schema.String },
  FillStart: { id: Schema.String },
  FillEnd: { id: Schema.String },
})
type Message = typeof Message.Type

/** The store's count for `when`; a newer choice interrupts an older count. */
const Count = Command.define("StockCount", {
  args: { when: StockWhen },
  messages: [Message.Counted, Message.Failed],
  interrupt: true,
  execute: ({ when }) =>
    Shop.use((shop) => shop.getStock(when)).pipe(
      Effect.map((levels) => Message.Counted({ when, levels })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ reason: textOf(error) }))),
    ),
})

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const label = (id: string): string => (model.filling.includes(id) ? "filling…" : `✓ ${model.levels[id] ?? 0} left`)
  return h.div([h.Class("stock")], [
    h.div([h.Class("stock-head")], [
      h.div([h.Class("segmented"), h.Role("group"), h.AriaLabel("When")], [
        h.button([h.AriaPressed(String(model.when === "now")), h.OnClick(Message.Choose({ when: "now" }))], ["Now"]),
        h.button([h.AriaPressed(String(model.when === "delivery")), h.OnClick(Message.Choose({ when: "delivery" }))], ["After the delivery"]),
      ]),
    ]),
    h.p([h.Class("stock-status muted"), h.AriaLive("polite")], [model.checking ? "Checking the store…" : "The store's count"]),
    h.ul(
      [h.Class("stock-list")],
      PIECES.map((piece) =>
        h.li([h.Class("stock-row")], [
          h.img([h.Src(photoOf(piece.id).small), h.Width("48"), h.Height("48"), h.Alt("")]),
          h.span([h.Class("name")], [piece.name]),
          h.span([h.Class("meter")], [
            // Foldkit hears the bar's animation through its Messages: one starts, one lands.
            w.span([h.Class("meter-fill"), w.Initial({ scaleX: 0 }), w.Animate({ scaleX: (model.levels[piece.id] ?? 0) / SHELF }), w.Transition(FILL), w.OnAnimationStart(Message.FillStart({ id: piece.id })), w.OnAnimationComplete(Message.FillEnd({ id: piece.id }))]),
          ]),
          h.span([h.Class("stock-label")], [label(piece.id)]),
        ]),
      ),
    ),
    ...(model.problem === null ? [] : [h.p([h.Class("error-line"), h.Role("alert")], [model.problem])]),
  ])
})

export default definePage({
  id: "stock",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.getStock("now")), (levels) => ({ levels })),
  init: ({ levels }): Model => ({ when: "now", levels, checking: false, filling: PIECES.map((piece) => piece.id), problem: null }),
  update: (model, message) =>
    Message.match(message, {
      Choose: ({ when }) => ({ model: { ...model, when, checking: true, problem: null }, commands: [Count({ when })] }),
      Counted: ({ when, levels }) => ({ model: when === model.when ? { ...model, levels, checking: false } : model }),
      Failed: ({ reason }) => ({ model: { ...model, checking: false, problem: reason } }),
      FillStart: ({ id }) => ({ model: { ...model, filling: model.filling.includes(id) ? model.filling : [...model.filling, id] } }),
      FillEnd: ({ id }) => ({ model: { ...model, filling: model.filling.filter((one) => one !== id) } }),
    }),
  view,
})
