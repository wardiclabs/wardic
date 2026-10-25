import { AnimatePresence, wardic } from "@wardic/solid/unstable/v2"
import { createSignal, For, Show } from "solid-js"

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

export default function DeliveryFaq() {
  const [open, setOpen] = createSignal(0)
  const toggle = (index: number) => {
    if (open() === index) setOpen(-1)
    else setOpen(index)
  }
  const stateOf = (index: number) => {
    if (open() === index) return "open"
    return "shut"
  }

  return (
    <ul class="faq">
      <For each={QUESTIONS}>
        {(item, index) => (
          // Each item grows as its answer opens: layout animates its size, its rounded corners and
          // shadow kept as they are while it scales, and the items below slide down to make room.
          <wardic.li class="faq-item" layout>
            <wardic.button class="faq-question" layout="position" aria-expanded={String(open() === index()) as "true" | "false"} onClick={() => toggle(index())}>
              <span>{item.question}</span>
              {/* initial={false}: the answer open when the page loads has its chevron turned already. */}
              <wardic.span class="chevron" variants={chevron} initial={false} animate={stateOf(index())} transition={{ duration: 0.2 }} aria-hidden="true">
                {/* Drawn centred in its box, so it turns about itself: a text "⌄" sits low in its line and swung up as it turned. */}
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </wardic.span>
            </wardic.button>
            {/* popLayout: a closing answer leaves the flow at once, so its card shrinks while it fades. */}
            <AnimatePresence initial={false} mode="popLayout">
              <Show when={open() === index()}>
                <wardic.div class="faq-answer" layout="position" {...answer}>
                  <p>{item.answer}</p>
                </wardic.div>
              </Show>
            </AnimatePresence>
          </wardic.li>
        )}
      </For>
    </ul>
  )
}
