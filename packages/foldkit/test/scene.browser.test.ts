// A Scene test of a view with Wardic elements (#791, Q27; ADR-0071, decision 36): every Wardic Mount is
// pending until the test resolves it by name, through the Handle's `Provider` and `Element`, with a
// Message the app's `update` ignores (Foldkit's `Completed*` convention). An element rendered by a later
// interaction needs its own resolve before the next step.
import { DomLive } from "@wardic/dom"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import * as Scene from "foldkit/scene"
import { describe, it } from "vitest"
import * as Wardic from "@wardic/foldkit/Wardic"

const Model = Schema.Struct({ cards: Schema.Array(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Add: {}, CompletedWardic: {} })
type Message = typeof Message.Type

const wardic = Wardic.make({ env: DomLive })

const update = (model: Model, message: Message) =>
  Message.match(message, {
    Add: () => ({ model: { cards: [...model.cards, `card ${model.cards.length + 1}`] } }),
    CompletedWardic: () => ({ model }),
  })

const view: Parameters<typeof Scene.scene<Model, Message>>[0]["view"] = (model, h) => {
  const w = wardic.html(h)
  return w.div([w.Provider()], [
    h.button([h.Id("add"), h.OnClick(Message.Add())], ["add"]),
    ...model.cards.map((card) => w.keyed("div")(card, [h.Class("card"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 })], [card])),
  ])
}

describe("Scene", () => {
  it("resolves Wardic's Mounts by name, the provider's and each element's", () => {
    Scene.scene(
      { update, view },
      Scene.given<Model>({ cards: ["card 1"] }),
      Scene.Mount.resolveAll([wardic.Provider, Message.CompletedWardic()], [wardic.Element, Message.CompletedWardic()]),
      Scene.click("#add"),
      Scene.Mount.resolve(wardic.Element, Message.CompletedWardic()),
      Scene.expect(Scene.text("card 2")).toExist(),
    )
  })
})
