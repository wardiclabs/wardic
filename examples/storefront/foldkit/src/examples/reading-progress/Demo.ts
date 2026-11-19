import { LAGOON_ARTICLE } from "@wardic/example-storefront-shared/stories"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { feed, onWardic, scroll } from "~/lib/live.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

// The Live values, Atoms at module scope (ADR-0071, decision 16): how far the article's panel is
// scrolled, from 0 to 1, which the panel's Mount feeds and the bar binds; and the minutes left, read
// from the same progress, which the head's text binds.
const progress = Atom.make(0)
const minutesLeft = Atom.map(progress, (at) => `${Math.ceil(LAGOON_ARTICLE.minutes * (1 - at))} min left`)

const Data = Schema.Struct({})
const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = defineMessageUnion({ Reading: {} })
type Message = typeof Message.Type

/**
 * The panel's Mount: its scroll as Live values (`Wardic.scroll`), set within the scroll's own
 * event, held while the panel is on the page. Leave out `container`, and it's the page's scroll.
 */
const Read = Mount.define("ReadingScroll", {
  messages: [Message.Reading],
  execute: ({ element }) =>
    onWardic(
      Effect.gen(function* () {
        const { scrollYProgress } = yield* scroll({ container: element })
        yield* feed(scrollYProgress, progress)
        return Message.Reading()
      }),
    ),
})

const view = defineView<Model, Message, PageEnv>((_model, _env, h) => {
  const w = wardic.html(h)
  return h.div([h.Class("reading")], [
    h.div([h.Class("reading-head")], [h.strong([], [LAGOON_ARTICLE.title]), w.span([h.Class("muted"), h.AriaLive("polite"), w.Text(minutesLeft)])]),
    // The bar is the scroll itself, scaled across from its left edge: no animation of its own.
    w.div([h.Class("reading-bar"), w.Style({ scaleX: progress })]),
    h.div(
      [h.Class("reading-panel"), h.OnMount(Read()), h.Attribute("tabindex", "0"), h.AriaLabel(LAGOON_ARTICLE.title)],
      LAGOON_ARTICLE.sections.map((section) => h.section([], [h.h3([], [section.heading]), ...section.paragraphs.map((paragraph) => h.p([], [paragraph]))])),
    ),
  ])
})

export default definePage({
  id: "reading-progress",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({}),
  update: (model, message) => Message.match(message, { Reading: () => ({ model }) }),
  view,
})
