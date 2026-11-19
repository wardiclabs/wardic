/**
 * An example's page (#296 Q3): the live demo, a line on what reduced motion does to it, why it's
 * worth reaching for, then its code, highlighted on the server. The demo is the example's page
 * module, a submodel keyed by its run, so Replay mounts it afresh.
 */
import { AREAS, type Example, exampleById } from "@wardic/example-storefront-shared/examples"
import { BACK } from "@wardic/example-storefront-shared/micro"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Html, HtmlBuilder } from "foldkit/html"
import { wardic } from "~/lib/wardic.ts"
import { Message, type Model } from "~/model.ts"
import type { PageEnv } from "~/page.ts"
import { pageOf } from "~/pages.ts"
import type { Highlighted } from "~/shop.ts"
import { summaryOf, titleOf, tradeoffsOf, usesOf } from "~/views/words.ts"
import { prose } from "~/views/prose.ts"

const codeFile = (h: HtmlBuilder<Message>, file: Highlighted): Html => h.div([h.Class("code-file")], [h.header([], [file.path]), h.div([h.InnerHTML(file.html)])])

/** The demo's code, this app's files for the example, with what differs on Foldkit above (the registry's note). */
const codePanel = (model: Model, h: HtmlBuilder<Message>, example: Example): Html => {
  const code = model.code
  return h.section([h.Class("code"), h.AriaLabelledBy("code-title")], [
    h.h2([h.Id("code-title")], ["The code"]),
    ...UndefinedOr.match(example.foldkit, { onUndefined: () => [], onDefined: ({ note }) => [h.p([h.Class("code-note")], prose(h, note))] }),
    ...(code === null ? [h.pre([h.Class("muted")], ["Highlighting…"])] : code.own.map((file) => codeFile(h, file))),
  ])
}

/** An example's gains and costs (#526 Q6), where it has them: two short lists. */
const tradeoffs = (h: HtmlBuilder<Message>, gains: ReadonlyArray<string>, costs: ReadonlyArray<string>): Html =>
  h.section([h.Class("tradeoffs"), h.AriaLabel("Gains and costs")], [
    h.div([h.Class("gains")], [h.h3([], ["Gains"]), h.ul([], gains.map((gain) => h.li([], prose(h, gain))))]),
    h.div([h.Class("costs")], [h.h3([], ["Costs"]), h.ul([], costs.map((cost) => h.li([], prose(h, cost))))]),
  ])

/** The demo: the page's view under the route, keyed by its run; a loading line or the failure before. */
const demo = (model: Model, h: HtmlBuilder<Message>, env: PageEnv): Html => {
  const page = model.page
  if (page._tag === "Loaded") {
    return Option.match(pageOf(page.id), {
      onNone: () => h.p([h.Class("error-line"), h.Role("alert")], [`No page for "${page.id}".`]),
      onSome: (definition) =>
        h.keyed("div")(`run-${page.run}`, [h.Class("demo-run")], [
          h.submodel({ slotId: "demo", model: page.model, view: definition.view, viewInputs: env, toParentMessage: (message) => Message.Page({ id: page.id, message }) }),
        ]),
    })
  }
  if (page._tag === "Failed") return h.p([h.Class("error-line"), h.Role("alert")], [page.reason])
  return h.p([h.Class("muted")], ["Loading the shop…"])
}

export const notFound = (h: HtmlBuilder<Message>): Html =>
  h.main([h.Class("page")], [h.section([h.Class("hero")], [h.h1([], ["There's no page here."]), h.p([], [h.a([h.Href("/")], ["Back to the examples"])])])])

export const examplePage = (model: Model, h: HtmlBuilder<Message>, id: string, env: PageEnv): Html => {
  const example = exampleById(id)
  if (example === undefined) return notFound(h)
  const area = AREAS.find((one) => one.id === example.area)
  if (area === undefined) return notFound(h)
  const w = wardic.html(h)
  return h.main([h.Class("page example")], [
    h.nav([h.Class("crumbs"), h.AriaLabel("Breadcrumb")], [
      // The crumbs' link home: its hover's name passes to its arrow, which nudges toward where it goes (#365).
      w.a([h.Href("/"), w.Initial("rest"), w.Animate("rest"), w.WhileHover("hover"), w.WhileFocus("hover")], [w.span([h.Class("glyph"), w.Variants(BACK)], ["←"]), " Examples"]),
      ` / ${area.title}`,
    ]),
    h.header([h.Class("example-head")], [
      h.p([h.Class("eyebrow")], [area.title]),
      h.h1([], [titleOf(example)]),
      h.p([h.Class("muted")], [summaryOf(example)]),
      h.ul([h.Class("tags")], usesOf(example).map((use) => h.li([], [use]))),
    ]),
    h.section([h.Class("demo"), h.AriaLabel("Demo")], [
      h.div([h.Class("demo-bar")], [h.span([h.Class("eyebrow")], ["Live demo"]), h.button([h.Class("button quiet"), h.OnClick(Message.Replay())], ["Replay"])]),
      demo(model, h, env),
    ]),
    h.p([h.Class("note")], [h.strong([], ["Reduced motion:"]), " ", ...prose(h, example.reducedMotion)]),
    h.section([h.Class("why")], [
      h.h2([], ["Why"]),
      ...example.why.map((paragraph) => h.p([], prose(h, paragraph))),
      ...UndefinedOr.match(tradeoffsOf(example), { onUndefined: () => [], onDefined: ({ gains, costs }) => [tradeoffs(h, gains, costs)] }),
    ]),
    codePanel(model, h, example),
  ])
}
