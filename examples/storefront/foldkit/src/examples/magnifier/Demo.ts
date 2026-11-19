import { photoOf } from "@wardic/example-storefront-shared/images"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { LiveValue } from "@wardic/foldkit"
import { feed, listen, onWardic } from "~/lib/live.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

const ZOOM = 2.5
const LENS = 160

// Hover or press names a variant on the photo; the lens, a Variant child, grows in under it.
const frame = { rest: {}, looking: {} }
const lens = {
  rest: { opacity: 0, scale: 0.6 },
  looking: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 400, damping: 28 } },
} as const

// The Live values, Atoms at module scope (ADR-0071, decision 16). Where the pointer is over the photo,
// from its corner, which the photo's Mount writes; where the lens is, which the view binds, fed from
// the springs that follow the pointer; and how wide the photo is drawn.
const pointerX = Atom.make(LENS)
const pointerY = Atom.make(LENS)
const lensX = Atom.make(LENS)
const lensY = Atom.make(LENS)
const width = Atom.make(0)
// The photo inside the lens, placed so its centre shows what's under the lens, ZOOM times larger:
// a custom property each, which the stylesheet's `background-position` reads, derived from the lens's place.
const insideX = Atom.map(lensX, (at) => `${LENS / 2 - at * ZOOM}px`)
const insideY = Atom.map(lensY, (at) => `${LENS / 2 - at * ZOOM}px`)
const insideSize = Atom.map(width, (drawn) => `${drawn * ZOOM}px`)

const Data = Schema.Struct({})
const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = defineMessageUnion({ Following: {} })
type Message = typeof Message.Type

/**
 * The photo's Mount: the lens follows the pointer on a spring, so it glides after it and settles where
 * it stops. The springs are made on Wardic's services for as long as the photo is on the page, and
 * the lens's Atoms follow them. `pointermove` hears a mouse over the photo and a finger dragging on
 * it, and `pointerdown` a finger's press where it lands, since a finger never hovers
 * (`touch-action: none` keeps the page from scrolling under it). Under reduced
 * motion the lens doesn't glide, it's where the pointer is: a live value is yours, so Wardic's
 * reduced motion leaves it alone, and the springs jump instead.
 */
const Follow = Mount.define("MagnifierFollow", {
  args: { reduced: Schema.Boolean },
  messages: [Message.Following],
  execute: ({ element, reduced }) =>
    onWardic(
      Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const skipped = () => reduced
        const x = yield* LiveValue.spring(pointerX, { stiffness: 380, damping: 32 }, skipped)
        const y = yield* LiveValue.spring(pointerY, { stiffness: 380, damping: 32 }, skipped)
        yield* feed(x, lensX)
        yield* feed(y, lensY)
        const place = (event: PointerEvent): void => {
          const box = element.getBoundingClientRect()
          registry.set(width, box.width)
          registry.set(pointerX, event.clientX - box.left)
          registry.set(pointerY, event.clientY - box.top)
        }
        yield* listen(element, "pointermove", place)
        yield* listen(element, "pointerdown", place)
        return Message.Following()
      }),
    ),
})

const view = defineView<Model, Message, PageEnv>((_model, env, h) => {
  const w = wardic.html(h)
  const photo = photoOf("lagoon-vase")
  return h.div([h.Class("magnifier")], [
    // Keyed by the reduced-motion setting: the switch mounts the photo afresh, and its Mount reads the setting once.
    w.keyed("div")(
      `photo-${String(env.reduceMotion)}`,
      [h.Class("magnifier-photo"), h.OnMount(Follow({ reduced: env.reduceMotion })), w.Variants(frame), w.Initial("rest"), w.Animate("rest"), w.WhileHover("looking"), w.WhileTap("looking")],
      [
        h.img([h.Src(photo.large), h.Width(String(photo.width)), h.Height(String(photo.height)), h.Alt("The Lagoon Vase, up close"), h.Draggable(false)]),
        w.div([
          h.Class("lens"),
          h.AriaHidden(true),
          w.Variants(lens),
          w.Style({ x: lensX, y: lensY, "--inside-x": insideX, "--inside-y": insideY, "--inside-size": insideSize }),
          h.Style({ "background-image": `url(${photo.large})` }),
        ]),
      ],
    ),
    h.p([h.Class("muted")], ["Hover over the vase to look closer, or press and drag on a phone."]),
  ])
})

export default definePage({
  id: "magnifier",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({}),
  update: (model, message) => Message.match(message, { Following: () => ({ model }) }),
  view,
})
