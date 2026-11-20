import { DomLive } from "@wardic/dom"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { Features, Wardic } from "@wardic/foldkit"

// `Wardic.scroll` reads on the `scroll` Feature: the Handle names it.
const wardic = Wardic.make({ env: DomLive, features: [Features.scroll] })

const LINES = [
  "The kiln is cooling.",
  "Twelve bowls went in this morning, glazed in lagoon blue.",
  "By evening the glaze has run and pooled where the walls meet the foot.",
  "Each one comes out a little different from the last.",
  "Two have crazed: fine lines all over, like ice on a pond.",
  "One cracked in the cooling, and goes on the shelf by the door.",
  "The rest are wrapped in paper and packed for the morning post.",
]

// The Live value the bar binds, an Atom at module scope: how far the panel is scrolled, from 0 to 1.
const progress = Atom.make(0)

const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = defineMessageUnion({ Reading: {} })
type Message = typeof Message.Type

export const init = (): Model => ({})
export const update = (model: Model, message: Message) => Message.match(message, { Reading: () => ({ model }) })

/** The panel's Mount: its scroll as Live values (`Wardic.scroll`), fed into `progress` while the panel is on the page. Without `container`, it's the page's. */
const Read = Mount.define("Read", {
  messages: [Message.Reading],
  execute: ({ element }) =>
    Effect.provide(
      Wardic.provide(
        Effect.gen(function* () {
          const { scrollYProgress } = yield* Effect.orDie(Wardic.scroll({ container: element }))
          const registry = yield* AtomRegistry.AtomRegistry
          const stop = registry.subscribe(scrollYProgress, (at) => registry.set(progress, at), { immediate: true })
          yield* Effect.addFinalizer(() => Effect.sync(stop))
          return Message.Reading()
        }),
      ),
      wardic.resources,
    ),
})

/** A panel's scroll, shown as a bar across its top: the bar is the scroll itself, with no animation of its own. */
export const view = (_model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-scroller")], [
    w.div([h.Class("sample-progress"), w.Style({ scaleX: progress })]),
    h.div([h.Class("sample-scroll"), h.OnMount(Read()), h.Tabindex(0), h.AriaLabel("From the studio")], LINES.map((line) => h.p([], [line]))),
  ])
}
