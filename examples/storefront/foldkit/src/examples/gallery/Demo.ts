import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

// The photo coming in arrives from the side you're heading to, and the one leaving goes out the
// other side. Both read which way you went: the new photo from its own `Custom`, the leaving one
// from the presence's, since a photo that has already left takes no new attributes.
const slide = {
  enter: (direction: number) => ({ x: direction * 320, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * -320, opacity: 0 }),
}

const glide = {
  x: { type: "spring", stiffness: 300, damping: 32 },
  opacity: { type: "tween", duration: 0.2 },
} as const

// A swipe, as Motion's slideshow judges one: the release's distance times its speed, across. A
// throw to the left goes forward, to the right back; anything softer springs back to the centre.
const SWIPE = 10_000
const stepOf = (offset: number, velocity: number): number => {
  const swipe = Math.abs(offset) * velocity
  if (swipe < -SWIPE) return 1
  if (swipe > SWIPE) return -1
  return 0
}

const PIECES = ["lagoon-vase", "moon-vase", "bottle-vase", "tulip-bowl", "blossom-jar"].map((id) => {
  const piece = PRODUCTS.find((product) => product.id === id)
  if (piece === undefined) throw new Error(`No product "${id}"`)
  return piece
})

const Data = Schema.Struct({})
// +1 forward, -1 back: set before the photo changes, so both photos read it.
const Model = Schema.Struct({ at: Schema.Number, direction: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Go: { to: Schema.Number }, Swiped: { offsetX: Schema.Number, velocityX: Schema.Number }, Key: { key: Schema.String } })
type Message = typeof Message.Type

const view = defineView<Model, Message, PageEnv>((model, env, h) => {
  const w = wardic.html(h)
  // Under reduced motion the photos cross-fade in place: the slide has no distance. (Left to the
  // rule for positional values, a leaving photo would jump aside at once and fade there.) The
  // system's setting, or the header's switch.
  const way = model.direction * Number(!env.reduceMotion)
  const piece = PIECES[model.at]
  const image = photoOf(piece.id)
  return h.div([h.Class("gallery")], [
    h.div(
      [h.Class("gallery-stage"), h.Tabindex(0), h.Role("region"), h.AriaRoleDescription("carousel"), h.AriaLabel("Photos: left and right arrow keys move between them"), h.OnKeyDown((key) => Message.Key({ key }))],
      [
        // initial: false: the first photo is there when the page opens; only changes slide.
        w.div([h.Class("gallery-photos"), w.Presence({ custom: way, initial: false })], [
          w.keyed("img")(piece.id, [
            h.Class("gallery-photo"),
            // Dragged across, held at the centre and followed all the way: a swipe steps, its
            // photo going on out the way it was thrown.
            w.Drag("x"),
            w.DragConstraints({ left: 0, right: 0 }),
            w.DragElastic(1),
            w.OnDragEnd((_event, info) => Message.Swiped({ offsetX: info.offset.x, velocityX: info.velocity.x })),
            w.Custom(way),
            w.Variants(slide),
            w.Initial("enter"),
            w.Animate("center"),
            w.Exit("exit"),
            w.Transition(glide),
            h.Src(image.large),
            h.Srcset(srcsetOf(image)),
            h.Sizes("(max-width: 640px) 100vw, 560px"),
            h.Width(String(image.width)),
            h.Height(String(image.height)),
            h.Alt(piece.name),
            h.Draggable(false),
          ]),
        ]),
        h.button([h.Class("icon-button gallery-prev"), h.AriaLabel("Previous photo"), h.OnClick(Message.Go({ to: model.at - 1 }))], ["‹"]),
        h.button([h.Class("icon-button gallery-next"), h.AriaLabel("Next photo"), h.OnClick(Message.Go({ to: model.at + 1 }))], ["›"]),
      ],
    ),
    h.p([h.Class("gallery-caption"), h.AriaLive("polite")], [h.strong([], [piece.name]), ` · ${model.at + 1} of ${PIECES.length}`]),
    h.ol(
      [h.Class("thumbs")],
      PIECES.map((one, index) => {
        const thumb = photoOf(one.id)
        return h.li([], [h.button([h.Class("thumb"), h.AriaLabel(`Show ${one.name}`), h.AriaPressed(String(index === model.at)), h.OnClick(Message.Go({ to: index }))], [h.img([h.Src(thumb.small), h.Width(String(thumb.width)), h.Height(String(thumb.height)), h.Alt("")])])])
      }),
    ),
  ])
})

/** `to`, wrapped around the pieces, with the direction it's in from `at`. */
const going = (model: Model, to: number) => {
  if (to === model.at) return { model }
  return { model: { at: (to + PIECES.length) % PIECES.length, direction: Math.sign(to - model.at) } }
}

export default definePage({
  id: "gallery",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ at: 0, direction: 1 }),
  update: (model, message) =>
    Message.match(message, {
      Go: ({ to }) => going(model, to),
      Swiped: ({ offsetX, velocityX }) => {
        const step = stepOf(offsetX, velocityX)
        if (step === 0) return { model }
        return going(model, model.at + step)
      },
      Key: ({ key }) => {
        if (key === "ArrowRight") return going(model, model.at + 1)
        if (key === "ArrowLeft") return going(model, model.at - 1)
        return { model }
      },
    }),
  view,
})
