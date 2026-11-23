/** The showcase's gallery (#296 Q3): each area, with its examples this app has. */
import { AREAS, examplesIn, routeOf } from "@wardic/example-storefront-shared/examples"
import { CARD, TAG } from "@wardic/example-storefront-shared/micro"
import type { Html, HtmlBuilder } from "foldkit/html"
import { wardic } from "~/lib/wardic.ts"
import type { Message } from "~/model.ts"
import { summaryOf, titleOf, usesOf } from "~/views/words.ts"

export const gallery = (h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.main([h.Class("page")], [
    h.section([h.Class("hero")], [
      h.p([h.Class("eyebrow")], ["Wardic on Foldkit"]),
      h.h1([], ["A small shop built to show what Wardic does."]),
      h.p([], ["Each example is a feature of the shop, with the code that makes it move and why it's worth reaching for."]),
    ]),
    // An area this app has none of yet isn't shown (#909: the Batch area is Solid 2's).
    ...AREAS.filter((area) => examplesIn(area.id, "foldkit").length > 0).map((area) =>
      h.section([h.Class("area"), h.AriaLabelledBy(`area-${area.id}`)], [
        h.div([h.Class("area-head")], [h.h2([h.Id(`area-${area.id}`)], [area.title]), h.p([h.Class("muted")], [area.blurb])]),
        h.div(
          [h.Class("example-cards")],
          examplesIn(area.id, "foldkit").map((example) =>
            // A gallery card: it lifts, glows and gives (#365).
            w.a([h.Class("example-card"), h.Href(routeOf(example)), w.Variants(CARD), w.Initial("rest"), w.Animate("rest"), w.WhileHover("hover"), w.WhileFocus("hover"), w.WhileTap("press")], [
              h.h3([], [titleOf(example)]),
              h.p([h.Class("muted")], [summaryOf(example)]),
              h.ul([h.Class("tags")], usesOf(example).map((use) => w.li([w.Variants(TAG)], [use]))),
            ]),
          ),
        ),
      ]),
    ),
  ])
}
