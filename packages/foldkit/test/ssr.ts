// Shared helpers for the foldkit-ssr tier (`*.ssr.test.ts`, packages/foldkit/vitest.ssr.config.ts; #794):
// a `makeApplication` program rendered statically through Foldkit's `renderToString`, and its markup
// read back through Solid's test reader, shared by both bindings' server tiers. Not a test file itself.
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import { renderToString } from "foldkit/experimental/server"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import type * as Wardic from "@wardic/foldkit/Wardic"
import { type Tag, tagsOf } from "../../solid/test/markup.ts"

export { type Tag, tagsOf } from "../../solid/test/markup.ts"

const Model = Schema.Struct({ on: Schema.Boolean })
type Model = typeof Model.Type
export type Message = { readonly _tag: "Noop" }

/** The HTML of `view` under `handle`, rendered on the server, statically (no build id). */
export const rendered = async <F>(handle: Wardic.Handle<F>, view: (w: Wardic.Html<Message, F>, h: HtmlBuilder<Message>) => Html): Promise<string> => {
  const config = {
    Model,
    init: () => ({ model: { on: false } }),
    update: (model: Model) => ({ model }),
    view: (_model: Model, h: HtmlBuilder<Message>): Document => ({ title: "ssr", body: view(handle.html(h), h) }),
    container: null,
  }
  const result = await Effect.runPromise(renderToString(config as never, { isHydratable: false }))
  return result.html
}

/** The tag with `id` in `html`, or none. */
export const tagOf = (html: string, id: string): Tag | undefined => Option.getOrUndefined(Arr.findFirst(tagsOf(html), (tag) => tag.attrs.id === id))

/** The parsed inline style of the element with `id` in `html` (empty with no `style` attribute), or none without the element. */
export const styleOf = (html: string, id: string): Readonly<Record<string, string>> | undefined => UndefinedOr.map(tagOf(html, id), (tag) => tag.style)

/** The element's Starting style: its inline style without the `animation` its Appear animation adds under a provider element (#794, PR 2). */
export const startingOf = (html: string, id: string): Readonly<Record<string, string>> | undefined => UndefinedOr.map(styleOf(html, id), (style) => Rec.remove(style, "animation"))
