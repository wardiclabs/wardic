// The foldkit-hydrate project's fixtures (#794, ADR-0044; ADR-0071 decision 35): each a program rendered on a
// server by the project's `serverRenderProgram` command and hydrated in Chromium by
// appear.hydrate.browser.test.ts, from this one module on both sides. Each element to watch carries
// `data-k`; a button sends the Message a test clicks for after hydration. Not a test file itself.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import { DomLive } from "@wardic/dom"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import type * as FoldkitRuntime from "foldkit/runtime"
import * as Features from "@wardic/foldkit/Features"
import type * as Ward from "@wardic/foldkit/Ward"
import * as Wardic from "@wardic/foldkit/Wardic"

/** The fixtures' Model: what a click changes after hydration (H6–H8). */
export const Model = Schema.Struct({ moved: Schema.Boolean, added: Schema.Boolean, items: Schema.Array(Schema.String) })
export type Model = typeof Model.Type
export const Message = defineMessageUnion({ Move: {}, Add: {}, Reorder: {} })
export type Message = typeof Message.Type

const init = (): { readonly model: Model } => ({ model: { moved: false, added: false, items: ["a", "b", "c"] } })

const update = (model: Model, message: Message): { readonly model: Model } =>
  Message.match(message, {
    Move: () => ({ model: { ...model, moved: true } }),
    Add: () => ({ model: { ...model, added: true } }),
    Reorder: () => ({ model: { ...model, items: Arr.reverse(model.items) } }),
  })

/** A fixture's program: `Runtime.makeApplication`'s config without its container, which the client gives. */
export type Program = Omit<FoldkitRuntime.ApplicationConfig<Model, Message>, "container">

/** A fixture: the Handle it hydrates with, and its program. */
export interface Fixture {
  readonly handle: Pick<Wardic.Handle, "hydrate">
  readonly program: Program
}

/**
 * What each export is: a fresh fixture per call, its Handle its own. Foldkit's `hydrate` owns the page for
 * its lifetime, so a test's program runs on after its host has left: a Handle shared across runs would keep
 * the first run's Provider element as its root (a second `w.Provider()` is reported and ignored), and the
 * layout observer would watch a detached tree. A Handle per program, as an app makes one.
 */
export type Make = () => Fixture

/** A Handle with `layout`, for H6. */
const handle = (): Wardic.Handle<readonly [typeof Features.layout]> => Wardic.make({ env: DomLive, features: [Features.layout] })
/** A Handle whose server renders no Appear animation (H5). */
const handleOff = (): Wardic.Handle => Wardic.make({ env: DomLive, appear: false })

/** A fixture's view: the Model, Foldkit's builder and the Handle's `w`, with the Handle's Features `F`. */
type View<F> = (model: Model, h: HtmlBuilder<Message>, w: Wardic.Html<Message, F>) => Html

/** A fixture on a Handle `make` makes, its view under a `w.div` root carrying `w.Provider()`. */
const fixture =
  <F>(make: () => Pick<Wardic.Handle<F>, "hydrate" | "html">, view: View<F>): Make =>
  () => {
    const made = make()
    return {
      handle: made,
      program: {
        Model,
        init,
        update,
        view: (model, h): Document => ({ title: "hydrate", body: view(model, h, made.html(h)) }),
      },
    }
  }

/** A tween long enough for a hydration in the middle of it: under a dev server, Foldkit's `hydrate` renders about half a second after it's called. */
const SLOW = { type: "tween", duration: 1.2 } as const

const BOX = { width: "40px", height: "40px", background: "teal" } as const

/** A card sliding in on {@link SLOW}, `data-k="card"`. */
const card = <F>(w: Wardic.Html<Message, F>, h: HtmlBuilder<Message>, attributes: ReadonlyArray<Ward.Attribute> = []): Html =>
  w.div([h.Attribute("data-k", "card"), h.Style(BOX), w.Initial({ opacity: 0, x: 0 }), w.Animate({ opacity: 1, x: 200 }), w.Transition(SLOW), ...attributes])

/** The card after a heading, so its path under the Provider element counts a sibling (H1, H2, H4). */
export const CARD: Make = fixture(handle, (_model, h, w) => w.div([h.Id("root"), w.Provider()], [h.h1([], ["hydrate"]), card(w, h)]))

const ITEM = { hidden: { opacity: 0, x: -30 }, shown: { opacity: 1, x: 0 } }

/** A list whose items stagger in by 0.12 s on a 1 s tween, each `data-k="i<n>"` (H3). */
export const LIST: Make = fixture(handle, (_model, h, w) =>
  w.div([h.Id("root"), w.Provider()], [
    w.ul([w.Initial("hidden"), w.Animate("shown"), w.Variants({ hidden: {}, shown: {} }), w.Transition({ type: "tween", duration: 1, staggerChildren: 0.12 })], [
      w.li([h.Attribute("data-k", "i0"), w.Variants(ITEM), h.Style({ height: "10px" })]),
      w.li([h.Attribute("data-k", "i1"), w.Variants(ITEM), h.Style({ height: "10px" })]),
      w.li([h.Attribute("data-k", "i2"), w.Variants(ITEM), h.Style({ height: "10px" })]),
    ]),
  ]))

/** The card on a Handle with `appear: false` (H5): no Appear animation on the server. */
export const OFF: Make = fixture(handleOff, (_model, h, w) => w.div([h.Id("root"), w.Provider()], [card(w, h)]))

/** The card beside one with `w.Appear(false)`, `data-k="still"`, which waits for the script (H5). */
export const STILL: Make = fixture(handle, (_model, h, w) =>
  w.div([h.Id("root"), w.Provider()], [
    card(w, h),
    w.div([h.Id("still"), h.Attribute("data-k", "still"), h.Style(BOX), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition(SLOW), w.Appear(false)]),
  ]))

/** A layout box entering (opacity and its own y); `#move` puts a 60 px spacer above it, a layout change (H6). */
export const LAYOUT: Make = fixture(handle, (model, h, w) =>
  w.div([h.Id("root"), w.Provider()], [
    h.button([h.Id("move"), h.OnClick(Message.Move())], ["move"]),
    ...Bool.match(model.moved, { onTrue: () => [h.div([h.Id("spacer"), h.Style({ height: "60px" })])], onFalse: () => [] }),
    w.div([h.Attribute("data-k", "box"), h.Style(BOX), w.Layout(), w.Initial({ opacity: 0, y: 40 }), w.Animate({ opacity: 1, y: 0 }), w.Transition(SLOW)]),
  ]))

/** The card, and after `#add` a second element entering by the engine, `data-k="late"` (H7). */
export const ADDED: Make = fixture(handle, (model, h, w) =>
  w.div([h.Id("root"), w.Provider()], [
    h.button([h.Id("add"), h.OnClick(Message.Add())], ["add"]),
    card(w, h),
    ...Bool.match(model.added, {
      onTrue: () => [w.div([h.Attribute("data-k", "late"), h.Style(BOX), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition({ type: "tween", duration: 0.5 })])],
      onFalse: () => [],
    }),
  ]))

/** A keyed staggered list, `data-k` its key; `#reorder` reverses the Model's order (H8). */
export const KEYED: Make = fixture(handle, (model, h, w) =>
  w.div([h.Id("root"), w.Provider()], [
    h.button([h.Id("reorder"), h.OnClick(Message.Reorder())], ["reorder"]),
    w.ul([h.Id("list"), w.Initial("hidden"), w.Animate("shown"), w.Variants({ hidden: {}, shown: {} }), w.Transition({ type: "tween", duration: 0.6, staggerChildren: 0.1 })], Arr.map(model.items, (key) =>
      w.keyed("li")(key, [h.Attribute("data-k", key), h.Id(`item-${key}`), w.Variants(ITEM), h.Style({ height: "10px" })], [key]))),
  ]))
