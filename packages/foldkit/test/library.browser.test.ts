// Elements the binding doesn't make (#791; ADR-0071 decision 18): a custom element Foldkit types with
// `CustomElement.define`, and a library-style part that takes an attribute list, each given a Ward through
// the bundle, `w.attributes(…)`, under a variant tree it inherits from by DOM ancestry.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import * as CustomElement from "foldkit/customElement"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import * as Wardic from "@wardic/foldkit/Wardic"
import { until } from "../../solid/test/browser-helpers.ts"
import { embed, type Embedded, opacityOf } from "./harness.ts"

const Model = Schema.Struct({ open: Schema.Boolean, color: Schema.String })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Open: { open: Schema.Boolean } })
type Message = typeof Message.Type

const update = (model: Model, message: Message) => Message.match(message, { Open: ({ open }) => ({ model: { ...model, open } }) })

const wardic = Wardic.make({ env: DomLive })

/** A custom element, as a library ships one: defined on the page, typed for Foldkit's views. */
class ColorSwatch extends HTMLElement {
  set color(value: string) {
    this.style.background = value
  }
}
customElements.define("color-swatch", ColorSwatch)
const swatch = CustomElement.define({ tag: "color-swatch", properties: { color: Schema.String }, events: {} })

/** A library-style part: a view function taking an attribute list for its root, as a component library's parts do. */
const chip = <M>(h: HtmlBuilder<M>, attributes: ReadonlyArray<Attribute<M> | ChildAttribute>, label: string): Html => h.span([h.Class("chip"), ...attributes], [label])

const list = { closed: { opacity: 0.2 }, open: { opacity: 1 } }
const item = { closed: { opacity: 0, x: -10 }, open: { opacity: 1, x: 0 } }

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

describe("the bundle on a library's elements", () => {
  it("animates a custom element and a library part, each a Variant child of the w.* above them", async () => {
    const held = embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { open: false, color: "teal" },
      update,
      view: (model, h) => {
        const w = wardic.html(h)
        const Swatch = swatch.withMessage(h)
        return w.ul([h.Id("list"), w.Variants(list), w.Initial("closed"), w.Animate(Bool.match(model.open, { onTrue: () => "open", onFalse: () => "closed" })), w.Transition({ duration: 0.2, ease: "linear" })], [
          // The custom element: its own property beside Wardic's attributes; keyed, since the bundle carries no identity stamp.
          Swatch([h.Key("swatch"), h.Id("swatch"), Swatch.Color(model.color), ...w.attributes({ variants: item, style: { width: "40px", height: "20px", display: "block" } })]),
          // The library part: the bundle spread into the attribute list it takes.
          chip(h, [h.Key("chip"), h.Id("chip"), ...w.attributes({ variants: item })], "chip"),
        ])
      },
      toMessage: (open) => Message.Open({ open }),
    })
    app = held
    await until(() => held.container.querySelector("#chip") !== null, 2000, "the parts render")
    const swatchEl = held.container.querySelector<HTMLElement>("#swatch")!
    const chipEl = held.container.querySelector<HTMLElement>("#chip")!
    // Each starts at the list's `closed`, resolved against its own variants, written at mount.
    await until(() => opacityOf(swatchEl) === 0 && opacityOf(chipEl) === 0, 2000, "both start closed")
    expect(swatchEl.style.transform).toBe("translateX(-10px)")
    // The custom element's own property is Foldkit's, untouched by Wardic.
    expect(swatchEl.style.background).toBe("teal")
    held.send(true)
    await until(() => opacityOf(swatchEl) === 1 && opacityOf(chipEl) === 1, 2000, "both follow the list to open")
    expect(chipEl.style.transform).toBe("none")
  })
})
