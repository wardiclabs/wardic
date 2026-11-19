import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { defineView } from "foldkit/submodel"
import { LiveValue, Wardic } from "@wardic/foldkit"
import { listen, onWardic } from "~/lib/live.ts"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

const MESSAGES = [
  "Free delivery on orders over £60",
  "New: the Lagoon glaze, fired in small batches",
  "Every piece is wrapped by hand",
  "Free returns within 30 days",
] as const

// How long each message stays, in milliseconds of the page being seen.
const HOLD = 4000

// The message going fades up and out, then the next fades up in (mode "wait").
const message = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "tween", duration: 0.2 },
} as const

// The Live values, Atoms at module scope (ADR-0071, decision 16): how far the message is through
// its time, 0 to 1, the bar under it, which its clock writes; and whether the strip is paused, a
// switch the clock reads each frame, which the Pause button's Command writes.
const progress = Atom.make(0)
const held = Atom.make(false)

const Data = Schema.Struct({})
const Model = Schema.Struct({ index: Schema.Number, held: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Next: {}, TogglePause: {}, Held: { on: Schema.Boolean } })
type Message = typeof Message.Type

/** Pause, or play: the switch the clock reads, set on Wardic's services. */
const Hold = Command.define("AnnouncementsHold", {
  args: { on: Schema.Boolean },
  messages: [Message.Held],
  execute: ({ on }) =>
    Effect.scoped(
      Wardic.provide(
        Effect.gen(function* () {
          const registry = yield* AtomRegistry.AtomRegistry
          registry.set(held, on)
          return Message.Held({ on })
        }),
      ),
    ),
})

/**
 * A message's clock, on its bar: each frame, the message's time runs on by the frame's own `delta`,
 * but only while someone can read it: not while the tab is in the background, the pointer rests on
 * the strip, or it's paused. At four seconds it sends `Next`. Each message is a new bar, so each has a
 * clock of its own, from nought; `initiallyHeld` is the switch as the bar mounts, since a Replay
 * starts the strip playing.
 */
const Clock = Mount.defineStream("AnnouncementsClock", {
  args: { initiallyHeld: Schema.Boolean },
  messages: [Message.Next],
  execute: ({ element, initiallyHeld }) =>
    Stream.callback<typeof Message.Next.Type>((queue) =>
      onWardic(
        Effect.gen(function* () {
          const registry = yield* AtomRegistry.AtomRegistry
          registry.set(progress, 0)
          registry.set(held, initiallyHeld)
          let hovered = false
          const strip = element.closest(".announcements")
          if (strip !== null) {
            yield* listen(strip, "pointerenter", () => {
              hovered = true
            })
            yield* listen(strip, "pointerleave", () => {
              hovered = false
            })
          }
          let shown = 0
          let sent = false
          yield* LiveValue.eachFrame((_, delta) => {
            if (sent || document.visibilityState !== "visible" || hovered || registry.get(held)) return
            shown += delta
            if (shown >= HOLD) {
              sent = true
              Queue.offerUnsafe(queue, Message.Next())
            } else registry.set(progress, shown / HOLD)
          })
        }),
      ),
    ),
})

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const text = MESSAGES[model.index % MESSAGES.length]
  return h.div([h.Class("announcements")], [
    // keyed: each message is a new child, so the last one leaves before the next enters.
    w.div([h.Class("announcement"), w.Presence({ mode: "wait" })], [
      w.keyed("p")(`message-${model.index}`, [h.Class("announcement-message"), w.Initial(message.initial), w.Animate(message.animate), w.Exit(message.exit), w.Transition(message.transition)], [text]),
    ]),
    w.keyed("div")(`bar-${model.index}`, [h.Class("announcement-bar"), h.OnMount(Clock({ initiallyHeld: model.held })), w.Style({ scaleX: progress })]),
    h.div([h.Class("announcement-controls")], [
      h.button([h.Type("button"), h.Class("button quiet"), h.AriaPressed(String(model.held)), h.OnClick(Message.TogglePause())], [model.held ? "Play" : "Pause"]),
      h.button([h.Type("button"), h.Class("button quiet"), h.OnClick(Message.Next())], ["Next"]),
    ]),
  ])
})

export default definePage({
  id: "announcements",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ index: 0, held: false }),
  update: (model, message) =>
    Message.match(message, {
      Next: () => ({ model: { ...model, index: (model.index + 1) % MESSAGES.length } }),
      TogglePause: () => ({ model: { ...model, held: !model.held }, commands: [Hold({ on: !model.held })] }),
      Held: () => ({ model }),
    }),
  view,
})
