import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"

const QUESTIONS = [
  {
    question: "How long does delivery take?",
    answer: "Two to three working days at home, and five to eight abroad. Each piece is wrapped by hand, so allow a day more around the holidays.",
  },
  {
    question: "What if something arrives broken?",
    answer: "Send us a photo of it within a week and we'll send another, or refund you in full. You don't need to send the pieces back.",
  },
  {
    question: "Can I return a piece?",
    answer: "Within 30 days, unused and in its box. We'll email you a label, and refund you once it's back with us.",
  },
  {
    question: "Are the pieces food safe?",
    answer: "Everything glazed inside is food safe. The burnished and unglazed pieces are for flowers or for looking at: each product's details say which.",
  },
] as const

// An answer fades in once its card has started to grow, and out quickly as it closes.
const answer = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { type: "tween", duration: 0.2, delay: 0.1 } },
  exit: { opacity: 0, transition: { type: "tween", duration: 0.1 } },
} as const

// The chevron turns over as its answer opens, on a short tween: a rotate's default is a lively
// spring that swings past and back, which a chevron shouldn't (ADR-0051). With no `type`, a
// `duration` makes a tween, eased out.
const chevron = { shut: { rotate: 0 }, open: { rotate: 180 } } as const

const Data = Schema.Struct({})
// Each answer opens on its own; the first is open as the page loads. `instant` while Open all or
// Close all lands: every card takes its new size, and every answer and chevron its end, with no
// animation (an Instant change, through `w.Config({ skipAnimations })`): four cards growing together,
// and the rest of the page sliding under them, would be a lot of motion for one click.
const Model = Schema.Struct({ open: Schema.Array(Schema.Number), instant: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Toggle: { index: Schema.Number }, OpenAll: {}, CloseAll: {}, Settled: {} })
type Message = typeof Message.Type

/** Two frames after an instant change, animations are back on. */
const Settle = Command.define("FaqSettle", { messages: [Message.Settled], interrupt: true, execute: Effect.sleep("40 millis").pipe(Effect.as(Message.Settled())) })

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  const isOpen = (index: number): boolean => model.open.includes(index)
  const stateOf = (index: number): "open" | "shut" => (isOpen(index) ? "open" : "shut")
  return h.div([h.Class("faq-demo")], [
    h.div([h.Class("chips")], [h.button([h.Class("chip"), h.OnClick(Message.OpenAll())], ["Open all"]), h.button([h.Class("chip"), h.OnClick(Message.CloseAll())], ["Close all"])]),
    w.ul(
      [h.Class("faq"), w.Config({ skipAnimations: model.instant })],
      QUESTIONS.map((item, index) =>
        // Each item grows as its answer opens: layout animates its size, its rounded corners and
        // shadow kept as they are while it scales, and the items below slide down to make room.
        w.keyed("li")(String(index), [h.Class("faq-item"), w.Layout()], [
          w.button([h.Class("faq-question"), w.Layout("position"), h.AriaExpanded(isOpen(index)), h.OnClick(Message.Toggle({ index }))], [
            h.span([], [item.question]),
            // Initial(false): the answer open when the page loads has its chevron turned already.
            w.span([h.Class("chevron"), w.Variants(chevron), w.Initial(false), w.Animate(stateOf(index)), w.Transition({ duration: 0.2 }), h.AriaHidden(true)], ["⌄"]),
          ]),
          // popLayout: a closing answer leaves the flow at once, so its card shrinks while it fades.
          w.div([w.Presence({ initial: false, mode: "popLayout" })], isOpen(index) ? [w.keyed("div")("answer", [h.Class("faq-answer"), w.Layout("position"), w.Initial(answer.initial), w.Animate(answer.animate), w.Exit(answer.exit)], [h.p([], [item.answer])])] : []),
        ]),
      ),
    ),
  ])
})

export default definePage({
  id: "delivery-faq",
  Data,
  Model,
  Message,
  load: Effect.succeed({}),
  init: (): Model => ({ open: [0], instant: false }),
  update: (model, message) =>
    Message.match(message, {
      Toggle: ({ index }) => ({ model: { ...model, open: model.open.includes(index) ? model.open.filter((one) => one !== index) : [...model.open, index] } }),
      OpenAll: () => ({ model: { ...model, open: QUESTIONS.map((_, index) => index), instant: true }, commands: [Settle()] }),
      CloseAll: () => ({ model: { ...model, open: [], instant: true }, commands: [Settle()] }),
      Settled: () => ({ model: { ...model, instant: false } }),
    }),
  view,
})
