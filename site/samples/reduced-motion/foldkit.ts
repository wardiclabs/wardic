import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import type * as Update from "foldkit/update"
import { wardic } from "~/lib/wardic.ts"

const SETTINGS = ["user", "always", "never"] as const
const Setting = Schema.Literals(SETTINGS)

const Model = Schema.Struct({ setting: Setting, moved: Schema.Boolean, prefers: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Set: { setting: Setting }, Move: {}, SystemMotion: { reduced: Schema.Boolean } })
type Message = typeof Message.Type

/** The visitor's own setting, as their system gives it: read once, in a Command, as the app starts (a Subscription on the media query would follow a change). */
const ReadSystemMotion = Command.define("ReadSystemMotion", {
  messages: [Message.SystemMotion],
  execute: Effect.sync(() => Message.SystemMotion({ reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches })),
})

export const init = (): Update.Return<Model, Message> => ({ model: { setting: "always", moved: false, prefers: false }, commands: [ReadSystemMotion()] })
export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Set: ({ setting }) => ({ model: { ...model, setting } }),
    Move: () => ({ model: { ...model, moved: !model.moved } }),
    SystemMotion: ({ reduced }) => ({ model: { ...model, prefers: reduced } }),
  })

/** One move under each setting: under reduced motion the box jumps across, and still fades. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-stack")], [
    h.div(
      [h.Class("sample-tabs"), h.Role("group"), h.AriaLabel("reducedMotion")],
      SETTINGS.map((value) => h.button([h.Class("sample-tab"), h.AriaPressed(String(model.setting === value)), h.OnClick(Message.Set({ setting: value }))], [value])),
    ),
    h.button([h.Class("sample-button"), h.OnClick(Message.Move())], ["Move"]),
    // `Config` sets the setting for the element and what's under it, as a `WardicConfig` does on Solid.
    w.div(
      [h.Class("sample-box"), w.Config({ reducedMotion: model.setting }), w.Animate({ x: model.moved ? 160 : 0, opacity: model.moved ? 0.4 : 1 }), w.Transition({ duration: 0.8, ease: "easeInOut" })],
      ["box"],
    ),
    h.p([h.Class("sample-note")], [`Your system ${model.prefers ? "asks" : "doesn't ask"} for reduced motion.`]),
  ])
}
