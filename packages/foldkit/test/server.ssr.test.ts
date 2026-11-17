// The Foldkit binding on a server (#794, PR 1; ADR-0071 decisions 2 and 35; ADR-0021): Foldkit's
// `renderToString` runs the view alone, no Mount, so what the HTML carries is what the view's build
// renders. Each fixture renders a program statically (no build id) and reads the HTML.
//
// - S0: the package's `server` condition: `IS_SERVER` reads true under Node, as on a server.
// - S1: a `w.*` element's Starting style in the HTML: `Initial` projected over `Style`, the transform
//   keys joined into one `transform`; `Animate` alone, no Starting style but the style's own.
// - S2: a Variant child's inherited Starting style under `w.Provider()` (Q2, Q7): the child with
//   `Variants` and no `Initial` of its own carries its ancestor's `Initial` name resolved against its own
//   variants, and a grandchild through a child with variants of its own; an own `Initial` and
//   `Inherit(false)` stop it (S3); without `w.Provider()` above, the HTML carries none (the Mount writes
//   it on the client).
// - S4: a `w.Style` Atom on the server, read through the scratch registry: a plain Atom's value, a
//   derived one's initial (#791, Q12).
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Atom from "effect/reactivity/Atom"
import * as Schema from "effect/Schema"
import { renderToString } from "foldkit/experimental/server"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { IS_SERVER } from "@wardic/foldkit/internal/server"
import * as Wardic from "@wardic/foldkit/Wardic"

const Model = Schema.Struct({ on: Schema.Boolean })
type Model = typeof Model.Type
type Message = { readonly _tag: "Noop" }

const wardic = Wardic.make({ env: DomLive })
type W = Wardic.Html<Message, never>

/** The HTML of a view rendered on the server, statically. */
const rendered = async (view: (w: W, h: HtmlBuilder<Message>) => Html): Promise<string> => {
  const config = {
    Model,
    init: () => ({ model: { on: false } }),
    update: (model: Model) => ({ model }),
    view: (_model: Model, h: HtmlBuilder<Message>): Document => ({ title: "ssr", body: view(wardic.html(h), h) }),
    container: null,
  }
  const result = await Effect.runPromise(renderToString(config as never, { isHydratable: false }))
  return result.html
}

/** The `style` attribute of the element with `id` in `html` as its declarations, sorted (the serializer's order is its own), or none. */
const styleOf = (html: string, id: string): ReadonlyArray<string> | undefined => {
  const idFirst = Option.fromNullOr(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*\\bstyle="([^"]*)"`).exec(html))
  const styleFirst = Option.fromNullOr(new RegExp(`<[a-z]+[^>]*\\bstyle="([^"]*)"[^>]*\\bid="${id}"`).exec(html))
  const value = Option.flatMap(Option.orElse(idFirst, () => styleFirst), (match) => Option.fromUndefinedOr(match[1]))
  return Option.getOrUndefined(Option.map(value, (declarations) => declarations.split(";").map((declaration) => declaration.trim()).filter((declaration) => declaration !== "").sort()))
}

describe("a server render of the Foldkit binding (#794)", () => {
  it("S0: the server condition reads true under Node", () => {
    expect(IS_SERVER).toBe(true)
  })

  it("S1: a w.* element's Starting style is in the HTML", async () => {
    const html = await rendered((w, h) =>
      h.div([], [
        w.div([h.Id("a"), w.Initial({ opacity: 0, x: 20 }), w.Animate({ opacity: 1, x: 0 }), h.Style({ color: "red" })], ["a"]),
        w.div([h.Id("b"), w.Animate({ opacity: 1 }), h.Style({ color: "blue" })], ["b"]),
      ]))
    expect(styleOf(html, "a"), "Initial projected over the style, x as a transform").toEqual(["color: red", "opacity: 0", "transform: translateX(20px)"])
    expect(styleOf(html, "b"), "Animate alone: the style's own").toEqual(["color: blue"])
  })

  it("S2: a Variant child's inherited Starting style is in the HTML under w.Provider(), not without", async () => {
    const list = (w: W, h: HtmlBuilder<Message>, provider: boolean): Html =>
      w.ul([h.Id("list"), ...Bool.match(provider, { onTrue: () => [w.Provider()], onFalse: () => [] }), w.Variants({ hidden: {}, shown: {} }), w.Initial("hidden"), w.Animate("shown")], [
        w.li([h.Id("item"), w.Variants({ hidden: { opacity: 0 }, shown: { opacity: 1 } })], [
          w.span([h.Id("grand"), w.Variants({ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } })], ["grand"]),
        ]),
        w.li([h.Id("own"), w.Variants({ hidden: { opacity: 0 }, shown: { opacity: 1 } }), w.Initial({ opacity: 0.5 })], ["own"]),
        w.li([h.Id("out"), w.Inherit(false), w.Variants({ hidden: { opacity: 0 }, shown: { opacity: 1 } })], ["out"]),
      ])
    const withProvider = await rendered((w, h) => list(w, h, true))
    expect(styleOf(withProvider, "item"), "the child's hidden, from the parent's name").toEqual(["opacity: 0"])
    expect(styleOf(withProvider, "grand"), "the grandchild's hidden, through the child").toEqual(["opacity: 0", "transform: translateY(8px)"])
    expect(styleOf(withProvider, "own"), "its own Initial stops the inheritance").toEqual(["opacity: 0.5"])
    expect(styleOf(withProvider, "out"), "Inherit(false) keeps it out").toBeUndefined()
    const without = await rendered((w, h) => list(w, h, false))
    expect(styleOf(without, "item"), "without w.Provider(): nothing inherited in the HTML").toBeUndefined()
  })

  it("S4: a w.Style Atom is read through the scratch registry on the server: a plain Atom's value, a derived one's initial", async () => {
    const width = Atom.make(120)
    const doubled = Atom.make((get) => get(width) * 2)
    const html = await rendered((w, h) => w.div([h.Id("live"), w.Style({ width, height: doubled, opacity: 1 })], ["live"]))
    expect(styleOf(html, "live"), "the Atoms' values, as a server reads them").toEqual(["height: 240px", "opacity: 1", "width: 120px"])
  })
})
