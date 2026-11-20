import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Scene from "foldkit/scene"
import { it } from "vitest"
import { Features, Wardic } from "@wardic/foldkit"

const wardic = Wardic.make({ env: DomLive, features: Features.domAnimation })

/** What's under test: a notice that fades in, and a button that grows under the pointer and undoes when it's clicked. */
const Model = Schema.Struct({ undone: Schema.Boolean })
type Model = typeof Model.Type
// `CompletedWardic` is the Message a Scene test resolves Wardic's Mounts with: `update` ignores it (Foldkit's `Completed*` convention).
const Message = defineMessageUnion({ Undo: {}, CompletedWardic: {} })
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match(message, {
    Undo: () => ({ model: { undone: true } }),
    CompletedWardic: () => ({ model }),
  })

const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return w.div([w.Provider()], [
    w.p([h.Role("status"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition({ duration: 0.2, ease: "linear" })], [model.undone ? "Undone" : "Saved"]),
    w.button([h.Id("undo"), h.OnClick(Message.Undo()), w.WhileHover({ scale: 1.1 }), w.WhileTap({ scale: 0.95 })], ["Undo"]),
  ])
}

// A Scene runs the view and `update` with no runtime: every Wardic Mount is pending until the test
// resolves it by name, through the Handle's `Provider` and `Element`, and nothing is animated, so a
// Scene asserts what the Model draws, the texts and attributes; the fade and the hover are the binding's
// own tests' concern. A click runs the element's `OnClick` (a `w.OnTap` is the press recognizer's, which
// a Scene never starts). An element rendered by a later interaction needs its own resolve before the next step.
it("shows the notice, and undoes when the button is clicked", () => {
  Scene.scene(
    { update, view },
    Scene.given<Model>({ undone: false }),
    // One resolve per Wardic element on the page: the Provider's, the notice's and the button's.
    Scene.Mount.resolveAll([wardic.Provider, Message.CompletedWardic()], [wardic.Element, Message.CompletedWardic()], [wardic.Element, Message.CompletedWardic()]),
    Scene.expect(Scene.text("Saved")).toExist(),
    Scene.click("#undo"),
    Scene.expect(Scene.text("Undone")).toExist(),
  )
})
