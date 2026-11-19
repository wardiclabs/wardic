import { type Hydration, hydrationOf } from "@wardic/example-storefront-shared/hydration"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

// The banner names a variant; its photo and lines follow, one after another. Nothing here asks for
// the server: Wardic writes this entrance into the page's CSS, so it plays from the first paint.
const banner = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
}

const photo = {
  hidden: { opacity: 0, scale: 1.12 },
  shown: { opacity: 1, scale: 1, transition: { duration: 1.6, ease: "easeOut" } },
} as const

const line = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 140, damping: 20 } },
} as const

const vase = photoOf("lagoon-vase")

const Data = Schema.Struct({})
/** When the JavaScript took over, in ms from the page's start; `null` as the server renders. */
const Model = Schema.Struct({ tookOver: Schema.NullOr(Schema.Number) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ TookOver: { ms: Schema.Number } })
type Message = typeof Message.Type

/** The take-over, once: a replay inits the page again, and keeps it. */
let tookOver: number | undefined

/**
 * The status line's Mount is the JavaScript's arrival: a Mount runs on the client alone, once its
 * element is on the page, and the server renders the line without it.
 */
const Report = Mount.define("HydrationReport", {
  messages: [Message.TookOver],
  execute: () =>
    Effect.sync(() => {
      if (tookOver === undefined) tookOver = Math.round(performance.now())
      return Message.TookOver({ ms: tookOver })
    }),
})

/** What the server says is coming, before the JavaScript arrives: from the page's `?hydrate=`. */
const waiting = (hydration: Hydration): string => {
  if (hydration.kind === "off") return "No JavaScript on this page: what moved is the server's HTML and CSS alone."
  if (hydration.kind === "late") return `Waiting for the JavaScript, held back ${hydration.ms / 1000} s…`
  return "Waiting for the JavaScript…"
}

/** What the JavaScript is doing: the server says what's coming, the browser when it arrived. */
const status = (model: Model, env: PageEnv): string => {
  if (model.tookOver === null) return waiting(hydrationOf(new URLSearchParams(env.query).get("hydrate")))
  return `The JavaScript took over at ${model.tookOver} ms; the banner had been moving since the first paint.`
}

const view = defineView<Model, Message, PageEnv>((model, env, h) => {
  const w = wardic.html(h)
  return h.div([], [
    w.section([h.Class("season"), w.Variants(banner), w.Initial("hidden"), w.Animate("shown")], [
      h.div([h.Class("season-photo")], [
        w.img([w.Variants(photo), h.Src(vase.large), h.Srcset(srcsetOf(vase)), h.Sizes("(max-width: 640px) 100vw, 480px"), h.Width(String(vase.width)), h.Height(String(vase.height)), h.Alt("The Lagoon Vase")]),
      ]),
      h.div([h.Class("season-copy")], [
        w.p([h.Class("eyebrow"), w.Variants(line)], ["New this season"]),
        w.h2([w.Variants(line)], ["Glazes that ran in the kiln"]),
        w.p([w.Variants(line)], ["Two glazes poured over each other, left to find their own way in the heat. No two came out alike."]),
        w.a([h.Class("button accent"), h.Href("/entrances/product-grid"), w.Variants(line), w.WhileHover({ y: -2 }), w.WhileTap({ scale: 0.97 })], ["See the pieces"]),
      ]),
    ]),
    h.div([h.Class("hydration")], [
      h.p([h.Class("hydration-status"), h.Role("status"), h.OnMount(Report())], [status(model, env)]),
      // Full page loads, not the app's: a link with `?hydrate=` is one, the app's routing says (app.ts).
      h.nav([h.Class("hydration-links"), h.AriaLabel("Load this page again")], [
        h.a([h.Class("button quiet"), h.Href("/server/before-hydration?hydrate=2000")], ["Hydrate 2 s late"]),
        h.a([h.Class("button quiet"), h.Href("/server/before-hydration?hydrate=off")], ["Don't hydrate"]),
        h.a([h.Class("button quiet"), h.Href("/server/before-hydration?hydrate=now")], ["Hydrate at once"]),
      ]),
    ]),
  ])
})

export default definePage({
  id: "before-hydration",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ tookOver: null }),
  update: (model, message) => Message.match(message, { TookOver: ({ ms }) => ({ model: { ...model, tookOver: ms } }) }),
  view,
})
