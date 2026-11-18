import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { LiveValue } from "@wardic/foldkit"
import { feed, listen, onWardic } from "~/lib/live.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

const SHELF = PRODUCTS.filter((product) => ["poppy-plate", "blossom-jar", "slip-dish"].includes(product.id))

/** How far a card tilts toward the pointer at its edge, in degrees. */
const TILT = 8

// Under the pointer the card's light comes on: a custom property the stylesheet's glow reads.
const lighting = {
  rest: { "--light": 0 },
  lit: { "--light": 1 },
} as const

/** A card's Live values, Atoms at module scope (ADR-0071, decision 16), one set a card. */
interface CardValues {
  /** Where the pointer is over the card, from -1 to 1 across and down: 0, 0 at its centre. The card's Mount writes them. */
  readonly across: Atom.Writable<number>
  readonly down: Atom.Writable<number>
  /** What the view binds: the tilt, and where the light sits, custom properties the stylesheet's radial gradient reads. */
  readonly rotateX: Atom.Writable<number>
  readonly rotateY: Atom.Writable<number>
  readonly lightX: Atom.Writable<string>
  readonly lightY: Atom.Writable<string>
}

const cardValues = (): CardValues => ({ across: Atom.make(0), down: Atom.make(0), rotateX: Atom.make(0), rotateY: Atom.make(0), lightX: Atom.make("50%"), lightY: Atom.make("50%") })
const CARDS: Readonly<Record<string, CardValues>> = Object.fromEntries(SHELF.map((product) => [product.id, cardValues()]))

const Data = Schema.Struct({})
const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = defineMessageUnion({ Lit: {} })
type Message = typeof Message.Type

/**
 * A card's Mount: two springs follow the pointer's place over it, so the card eases toward the pointer
 * and back to rest when it leaves; the tilt and the light's place are read from the springs, and the
 * view's Atoms follow them. A mouse over the card moves them at each `pointermove`, and `pointerleave`
 * sends them home; touch never hovers, so a finger moves nothing. Under reduced motion the card
 * doesn't tilt, and the light is where the pointer is: the springs jump.
 */
const Tilt = Mount.define("SpotlightTilt", {
  args: { id: Schema.String, reduced: Schema.Boolean },
  messages: [Message.Lit],
  execute: ({ element, id, reduced }) =>
    onWardic(
      Effect.gen(function* () {
        const values = CARDS[id]
        if (values === undefined) return Message.Lit()
        const registry = yield* AtomRegistry.AtomRegistry
        const skipped = () => reduced
        const springAcross = yield* LiveValue.spring(values.across, { stiffness: 260, damping: 22 }, skipped)
        const springDown = yield* LiveValue.spring(values.down, { stiffness: 260, damping: 22 }, skipped)
        const tilt = (degrees: number) => (at: number) => {
          if (reduced) return 0
          return at * degrees
        }
        yield* feed(Atom.map(springAcross, tilt(TILT)), values.rotateY)
        yield* feed(Atom.map(springDown, tilt(-TILT)), values.rotateX)
        yield* feed(yield* LiveValue.transform(springAcross, [-1, 1], ["0%", "100%"]), values.lightX)
        yield* feed(yield* LiveValue.transform(springDown, [-1, 1], ["0%", "100%"]), values.lightY)
        yield* listen(element, "pointermove", (event) => {
          if (event.pointerType !== "mouse") return
          // The point in the viewport, as a place on the card: -1 to 1 across and down.
          const box = element.getBoundingClientRect()
          registry.set(values.across, ((event.clientX - box.left) / box.width) * 2 - 1)
          registry.set(values.down, ((event.clientY - box.top) / box.height) * 2 - 1)
        })
        yield* listen(element, "pointerleave", () => {
          registry.set(values.across, 0)
          registry.set(values.down, 0)
        })
        return Message.Lit()
      }),
    ),
})

const card = (h: HtmlBuilder<Message>, env: PageEnv, product: Product): Html => {
  const w = wardic.html(h)
  const values = CARDS[product.id]
  const photo = photoOf(product.id)
  return h.li([], [
    // Keyed by the reduced-motion setting: the switch mounts the card afresh, and its Mount reads the setting once.
    w.keyed("article")(
      `${product.id}-${String(env.reduceMotion)}`,
      [
        h.Class("spot-card"),
        h.OnMount(Tilt({ id: product.id, reduced: env.reduceMotion })),
        w.Variants(lighting),
        w.Initial("rest"),
        w.Animate("rest"),
        w.WhileHover("lit"),
        ...(values === undefined ? [] : [w.Style({ rotateX: values.rotateX, rotateY: values.rotateY, "--light-x": values.lightX, "--light-y": values.lightY })]),
      ],
      [
        h.div([h.Class("photo")], [h.img([h.Src(photo.small), h.Srcset(srcsetOf(photo)), h.Sizes("(max-width: 640px) 100vw, 240px"), h.Width(String(photo.width)), h.Height(String(photo.height)), h.Alt(product.name)])]),
        h.div([h.Class("line")], [h.span([h.Class("name")], [product.name]), h.span([h.Class("price")], [formatPrice(product.price)])]),
      ],
    ),
  ])
}

const view = defineView<Model, Message, PageEnv>((_model, env, h) => h.ul([h.Class("spot-grid")], SHELF.map((product) => card(h, env, product))))

export default definePage({
  id: "spotlight",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({}),
  update: (model, message) => Message.match(message, { Lit: () => ({ model }) }),
  view,
})
