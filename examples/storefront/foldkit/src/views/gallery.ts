/** The showcase's gallery (#296 Q3): each area, with its examples this app has. */
import { AREAS, examplesIn, routeOf } from "@wardic/example-storefront-shared/examples"
import { CARD, TAG } from "@wardic/example-storefront-shared/micro"
import * as Bool from "effect/Boolean"
import type { Html, HtmlBuilder } from "foldkit/html"
import { wardic } from "~/lib/wardic.ts"
import type { Message } from "~/model.ts"
import { summaryOf, titleOf } from "~/views/words.ts"

/** Whether this app has an area's examples yet. */
const hasPages = (area: (typeof AREAS)[number]): boolean => examplesIn(area.id, "foldkit").length > 0

export const gallery = (h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  // The areas this app has, and the ones still to come.
  const ready = AREAS.filter(hasPages)
  const next = AREAS.filter((area) => Bool.not(hasPages(area)))
  return h.main([h.Class("page")], [
    h.section([h.Class("hero")], [
      h.p([h.Class("eyebrow")], ["Wardic on Foldkit"]),
      h.h1([], ["A small shop built to show what Wardic does."]),
      h.p([], ["Each example is a feature of the shop, with the code that makes it move and why it's worth reaching for."]),
    ]),
    ...ready.map((area) =>
      h.section([h.Class("area"), h.AriaLabelledBy(`area-${area.id}`)], [
        h.div([h.Class("area-head")], [h.h2([h.Id(`area-${area.id}`)], [area.title]), h.p([h.Class("muted")], [area.blurb])]),
        h.div(
          [h.Class("example-cards")],
          examplesIn(area.id, "foldkit").map((example) =>
            // A gallery card: it lifts, glows and gives (#365).
            w.a([h.Class("example-card"), h.Href(routeOf(example)), w.Variants(CARD), w.Initial("rest"), w.Animate("rest"), w.WhileHover("hover"), w.WhileFocus("hover"), w.WhileTap("press")], [
              h.h3([], [titleOf(example)]),
              h.p([h.Class("muted")], [summaryOf(example)]),
              h.ul([h.Class("tags")], example.uses.map((use) => w.li([w.Variants(TAG)], [use]))),
            ]),
          ),
        ),
      ]),
    ),
    ...(next.length === 0
      ? []
      : [
          h.section([h.Class("area"), h.AriaLabelledBy("area-next")], [
            h.div([h.Class("area-head")], [h.h2([h.Id("area-next")], ["Coming next"]), h.p([h.Class("muted")], [`${next.map((area) => area.title).join(", ")}.`])]),
          ]),
        ]),
  ])
}
