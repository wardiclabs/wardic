import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { type Collection, LOOKBOOK } from "@wardic/example-storefront-shared/stories"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { LiveValue } from "@wardic/foldkit"
import { feed, onWardic } from "~/lib/live.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

/** A banner's Live values, Atoms at module scope (ADR-0071, decision 16): how far its photo and its words have drifted, which the view binds and the banner's Mount feeds. */
interface Drift {
  readonly photoY: Atom.Writable<number>
  readonly wordsY: Atom.Writable<number>
}

const BANNERS: Readonly<Record<string, Drift>> = Object.fromEntries(LOOKBOOK.map((collection) => [collection.photo, { photoY: Atom.make(0), wordsY: Atom.make(0) }]))

const Data = Schema.Struct({})
const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = defineMessageUnion({ Drifting: {} })
type Message = typeof Message.Type

/**
 * A banner's Mount: its own progress through the panel, from `LiveValue.scroll` with a `target` and
 * Motion's `offset`, 0 as its top comes in at the bottom and 1 as its bottom leaves at the top, mapped
 * to a few dozen pixels of `y` for the photo and for the words, one each way: depth. A parallax is
 * motion of your own, so reduced motion is yours to apply: under it, neither drifts.
 */
const Depth = Mount.define("LookbookDepth", {
  args: { key: Schema.String, reduced: Schema.Boolean },
  messages: [Message.Drifting],
  execute: ({ element, key, reduced }) =>
    onWardic(
      Effect.gen(function* () {
        const drift = BANNERS[key]
        if (drift === undefined) return Message.Drifting()
        const { scrollYProgress } = yield* LiveValue.scroll({ container: element.parentElement, target: element, offset: ["start end", "end start"] })
        const depth = (travel: number) => (progress: number) => {
          if (reduced) return 0
          return (progress - 0.5) * travel
        }
        yield* feed(Atom.map(scrollYProgress, depth(90)), drift.photoY)
        yield* feed(Atom.map(scrollYProgress, depth(-70)), drift.wordsY)
        return Message.Drifting()
      }),
    ),
})

const banner = (h: HtmlBuilder<Message>, env: PageEnv, collection: Collection): Html => {
  const w = wardic.html(h)
  const drift = BANNERS[collection.photo]
  const photo = photoOf(collection.photo)
  // Keyed by the reduced-motion setting: the switch mounts the banner afresh, and its Mount reads the setting once.
  return h.keyed("section")(`${collection.photo}-${String(env.reduceMotion)}`, [h.Class("lookbook-banner"), h.OnMount(Depth({ key: collection.photo, reduced: env.reduceMotion }))], [
    w.img([h.Class("lookbook-photo"), ...(drift === undefined ? [] : [w.Style({ y: drift.photoY })]), h.Src(photo.large), h.Srcset(srcsetOf(photo)), h.Sizes("(max-width: 640px) 100vw, 720px"), h.Alt("")]),
    w.div([h.Class("lookbook-words"), ...(drift === undefined ? [] : [w.Style({ y: drift.wordsY })])], [h.h3([], [collection.title]), h.p([], [collection.blurb])]),
  ])
}

const view = defineView<Model, Message, PageEnv>((_model, env, h) =>
  h.div([h.Class("lookbook"), h.Attribute("tabindex", "0"), h.AriaLabel("The lookbook")], LOOKBOOK.map((collection) => banner(h, env, collection))),
)

export default definePage({
  id: "parallax",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({}),
  update: (model, message) => Message.match(message, { Drifting: () => ({ model }) }),
  view,
})
