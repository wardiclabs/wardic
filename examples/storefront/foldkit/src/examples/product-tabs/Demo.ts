import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"

const TABS = ["Description", "Details", "Delivery"] as const
const Tab = Schema.Literals(TABS)
type Tab = typeof Tab.Type

// The panel that's going fades up and out, then the next fades up in (mode: "wait").
const panel = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "tween", duration: 0.18 },
} as const

const Data = Schema.Struct({ piece: Product })
const Model = Schema.Struct({ piece: Product, tab: Tab })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Show: { tab: Tab } })
type Message = typeof Message.Type

const panelFor = (h: HtmlBuilder<Message>, tab: Tab, piece: Product): Html => {
  if (tab === "Description") return h.p([], [piece.description])
  if (tab === "Details") return h.ul([h.Class("details")], piece.details.map((detail) => h.li([], [detail])))
  return h.p([], ["Ships in two to three working days, wrapped in recycled paper. Delivery is free over $100, and you can return a piece within 30 days, unused and in its box."])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const image = photoOf(model.piece.id)
  return h.article([h.Class("product-page")], [
    h.div([h.Class("photo")], [h.img([h.Src(image.small), h.Srcset(srcsetOf(image)), h.Sizes("(max-width: 720px) 100vw, 420px"), h.Width(String(image.width)), h.Height(String(image.height)), h.Alt(model.piece.name)])]),
    h.div([h.Class("product-info")], [
      h.h2([h.Class("name")], [model.piece.name]),
      h.p([h.Class("price")], [formatPrice(model.piece.price)]),
      h.div(
        [h.Class("tabs"), h.Role("tablist"), h.AriaLabel("About this piece")],
        TABS.map((name) =>
          h.button([h.Class("tab"), h.Role("tab"), h.AriaSelected(model.tab === name), h.AriaControls("piece-panel"), h.OnClick(Message.Show({ tab: name }))], [
            name,
            // One indicator, under whichever tab is selected: its layoutId carries it from tab to tab.
            ...(model.tab === name ? [w.keyed("span")("indicator", [h.Class("tab-indicator"), w.LayoutId("tab-indicator")])] : []),
          ]),
        ),
      ),
      // Keyed by the tab: each tab is a new child, so the last one leaves before it enters.
      w.div([h.Class("tab-panel"), h.Id("piece-panel"), h.Role("tabpanel"), h.AriaLabel(model.tab), w.Presence({ mode: "wait", initial: false })], [
        w.keyed("div")(model.tab, [w.Initial(panel.initial), w.Animate(panel.animate), w.Exit(panel.exit), w.Transition(panel.transition)], [panelFor(h, model.tab, model.piece)]),
      ]),
    ]),
  ])
})

export default definePage({
  id: "product-tabs",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.getProduct("lagoon-vase")), (piece) => ({ piece })),
  init: ({ piece }): Model => ({ piece, tab: "Description" }),
  update: (model, message) => Message.match(message, { Show: ({ tab }) => ({ model: { ...model, tab } }) }),
  view,
})
