// The Foldkit binding on a server (#794, PR 1; ADR-0071 decisions 2 and 21; ADR-0021): Foldkit's
// `renderToString` runs the view alone, no Mount, so what the HTML carries is what the view's build
// renders. Each fixture renders a program statically (no build id) and reads the HTML back through
// Solid's markup reader, shared by both bindings' server tiers (`./ssr.ts`): the Starting style, apart
// from the `animation` an element's Appear animation adds under a provider element (PR 2).
//
// - S0: the package's `server` condition: `IS_SERVER` reads true under Node, as on a server.
// - S1: a `w.*` element's Starting style in the HTML: `Initial` projected over `Style`, the transform
//   keys joined into one `transform`; `Animate` alone, no Starting style but the style's own.
// - S2: a Variant child's inherited Starting style under `w.Provider()` (Q2, Q7): the child with
//   `Variants` and no `Initial` of its own carries its ancestor's `Initial` name resolved against its own
//   variants, and a grandchild through a child with variants of its own; without `w.Provider()` above,
//   the HTML carries none (the Mount writes it on the client).
// - S3: what stops the inheritance: an own `Initial`, and `Inherit(false)`.
// - S4: a `w.Style` Atom on the server, read through the scratch registry: a plain Atom's value, a
//   derived one's initial (#791, Q12).
// - S5: under `w.Presence({ initial: false })`, the children's HTML carries their `Animate` (#134), an
//   own `Animate` or an inherited name, through a plain element between; a nested `w.Presence()` without
//   it starts its own children at their `Initial`, as the nearest presence's word is the Mount's.
import * as Bool from "effect/Boolean"
import * as Atom from "effect/reactivity/Atom"
import type { Html, HtmlBuilder } from "foldkit/html"
import { describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { Features } from "@wardic/foldkit"
import { IS_SERVER } from "@wardic/foldkit/internal/server"
import * as Wardic from "@wardic/foldkit/Wardic"
import { type Message, rendered, startingOf } from "./ssr.ts"

const wardic = Wardic.make({ env: DomLive, features: [Features.presence] })
type W = Wardic.Html<Message, readonly [typeof Features.presence]>

/** The HTML of `view` under the fixture's Handle. */
const html = (view: (w: W, h: HtmlBuilder<Message>) => Html): Promise<string> => rendered(wardic, view)

const VARIANTS = { hidden: { opacity: 0 }, shown: { opacity: 1 } }

describe("a server render of the Foldkit binding (#794)", () => {
  it("S0: the server condition reads true under Node", () => {
    expect(IS_SERVER).toBe(true)
  })

  it("S1: a w.* element's Starting style is in the HTML", async () => {
    const page = await html((w, h) =>
      h.div([], [
        w.div([h.Id("a"), w.Initial({ opacity: 0, x: 20 }), w.Animate({ opacity: 1, x: 0 }), h.Style({ color: "red" })], ["a"]),
        w.div([h.Id("b"), w.Animate({ opacity: 1 }), h.Style({ color: "blue" })], ["b"]),
      ]))
    expect(startingOf(page, "a"), "Initial projected over the style, x as a transform").toEqual({ color: "red", opacity: "0", transform: "translateX(20px)" })
    expect(startingOf(page, "b"), "Animate alone: the style's own").toEqual({ color: "blue" })
  })

  it("S2: a Variant child's inherited Starting style is in the HTML under w.Provider(), not without", async () => {
    const list = (w: W, h: HtmlBuilder<Message>, provider: boolean): Html =>
      w.ul([h.Id("list"), ...Bool.match(provider, { onTrue: () => [w.Provider()], onFalse: () => [] }), w.Variants({ hidden: {}, shown: {} }), w.Initial("hidden"), w.Animate("shown")], [
        w.li([h.Id("item"), w.Variants(VARIANTS)], [
          w.span([h.Id("grand"), w.Variants({ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } })], ["grand"]),
        ]),
      ])
    const withProvider = await html((w, h) => list(w, h, true))
    expect(startingOf(withProvider, "item"), "the child's hidden, from the parent's name").toEqual({ opacity: "0" })
    expect(startingOf(withProvider, "grand"), "the grandchild's hidden, through the child").toEqual({ opacity: "0", transform: "translateY(8px)" })
    const without = await html((w, h) => list(w, h, false))
    expect(startingOf(without, "item"), "without w.Provider(): nothing inherited in the HTML").toEqual({})
  })

  it("S3: an own Initial and Inherit(false) stop the inheritance", async () => {
    const page = await html((w, h) =>
      w.ul([h.Id("list"), w.Provider(), w.Variants({ hidden: {}, shown: {} }), w.Initial("hidden"), w.Animate("shown")], [
        w.li([h.Id("own"), w.Variants(VARIANTS), w.Initial({ opacity: 0.5 })], ["own"]),
        w.li([h.Id("out"), w.Inherit(false), w.Variants(VARIANTS)], ["out"]),
      ]))
    expect(startingOf(page, "own"), "its own Initial stops the inheritance").toEqual({ opacity: "0.5" })
    expect(startingOf(page, "out"), "Inherit(false) keeps it out").toEqual({})
  })

  it("S4: a w.Style Atom is read through the scratch registry on the server: a plain Atom's value, a derived one's initial", async () => {
    const width = Atom.make(120)
    const doubled = Atom.make((get) => get(width) * 2)
    const page = await html((w, h) => w.div([h.Id("live"), w.Style({ width, height: doubled, opacity: 1 })], ["live"]))
    expect(startingOf(page, "live"), "the Atoms' values, as a server reads them").toEqual({ height: "240px", opacity: "1", width: "120px" })
  })

  it("S5: under w.Presence({ initial: false }), the children's HTML carries their Animate; a nested w.Presence() has its own word", async () => {
    const page = await html((w, h) =>
      w.div([h.Id("root"), w.Provider(), w.Variants({ hidden: {}, shown: {} }), w.Initial("hidden"), w.Animate("shown")], [
        w.ul([h.Id("held"), w.Presence({ initial: false })], [
          w.li([h.Id("own"), w.Initial({ opacity: 0, x: 20 }), w.Animate({ opacity: 1, x: 0 })], ["own"]),
          w.li([h.Id("named"), w.Variants(VARIANTS)], ["named"]),
          h.li([], [w.span([h.Id("between"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 })], ["between"])]),
          w.ul([h.Id("nested"), w.Presence({})], [
            w.li([h.Id("nested-child"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 })], ["nested"]),
          ]),
        ]),
      ]))
    expect(startingOf(page, "own"), "an own Animate, over the Initial its build rendered").toEqual({ opacity: "1", transform: "none" })
    expect(startingOf(page, "named"), "the inherited animate name, resolved against its variants").toEqual({ opacity: "1" })
    expect(startingOf(page, "between"), "held through a plain element between").toEqual({ opacity: "1" })
    expect(startingOf(page, "nested-child"), "a nested presence without initial: false starts its children at their Initial").toEqual({ opacity: "0" })
  })
})
