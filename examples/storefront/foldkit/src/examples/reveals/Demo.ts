import { photoOf } from "@wardic/example-storefront-shared/images"
import { STUDIO_CHAPTERS } from "@wardic/example-storefront-shared/stories"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

// Each chapter names a variant as it comes into view; its photo and words follow, one after another.
const chapter = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.1 } },
}

const part = {
  hidden: { opacity: 0, y: 28 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22 } },
} as const

const Data = Schema.Struct({})
const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = defineMessageUnion({ Read: {} })
type Message = typeof Message.Type

const view = defineView<Model, Message, PageEnv>((_model, _env, h) => {
  const w = wardic.html(h)
  return h.div(
    [h.Id("story-panel"), h.Class("story"), h.Tabindex(0), h.AriaLabel("The studio's story")],
    STUDIO_CHAPTERS.map((story) => {
      const photo = photoOf(story.photo)
      // In view once a third of it shows in the panel, named by its selector, since a view has no refs;
      // once, so scrolling back up doesn't hide it.
      return w.section([h.Class("chapter"), w.Variants(chapter), w.Initial("hidden"), w.WhileInView("shown"), w.Viewport({ root: "#story-panel", once: true, amount: 0.35 })], [
        w.img([w.Variants(part), h.Src(photo.small), h.Width(String(photo.width)), h.Height(String(photo.height)), h.Alt("")]),
        h.div([], [w.h3([w.Variants(part)], [story.title]), w.p([w.Variants(part)], [story.text])]),
      ])
    }),
  )
})

export default definePage({
  id: "reveals",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({}),
  update: (model, message) => Message.match(message, { Read: () => ({ model }) }),
  view,
})
