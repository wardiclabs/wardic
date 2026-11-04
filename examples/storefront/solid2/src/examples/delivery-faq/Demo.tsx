import { AnimatePresence, createInstantTransition, layout, LazyWardic, w } from "@wardic/solid/unstable/v2"
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

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function DeliveryFaq() {
  return (
    <LazyWardic features={[layout]}>
      <DeliveryFaqDemo />
    </LazyWardic>
  )
}

function DeliveryFaqDemo() {
  // Each answer opens on its own; the first is open as the page loads.
  const [open, setOpen] = createSignal<ReadonlySet<number>>(new Set([0]))
  const isOpen = (index: number) => open().has(index)
  const toggle = (index: number) => {
    const next = new Set(open())
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setOpen(next)
  }
  const stateOf = (index: number) => {
    if (isOpen(index)) return "open"
    return "shut"
  }
  // Open all and Close all land at once: an Instant change, so every card takes its new size, and
  // every answer and chevron its end, with no animation. Four cards growing together, and the rest
  // of the page sliding under them, would be a lot of motion for one click.
  const startInstant = createInstantTransition()
  const all = () => new Set(QUESTIONS.map((_, index) => index))

  return (
    <div class="faq-demo">
      <div class="chips">
        <button class="chip" onClick={() => startInstant(() => setOpen(all()))}>
          Open all
        </button>
        <button class="chip" onClick={() => startInstant(() => setOpen(new Set<number>()))}>
          Close all
        </button>
      </div>
      <ul class="faq">
        <For each={QUESTIONS}>
          {(item, index) => (
            // Each item grows as its answer opens: layout animates its size, its rounded corners and
            // shadow kept as they are while it scales, and the items below slide down to make room.
            <w.li class="faq-item" layout>
              <w.button class="faq-question" layout="position" aria-expanded={String(isOpen(index())) as "true" | "false"} onClick={() => toggle(index())}>
                <span>{item.question}</span>
                {/* initial={false}: the answer open when the page loads has its chevron turned already. */}
                <w.span class="chevron" variants={chevron} initial={false} animate={stateOf(index())} transition={{ duration: 0.2 }} aria-hidden="true">
                  ⌄
                </w.span>
              </w.button>
              {/* popLayout: a closing answer leaves the flow at once, so its card shrinks while it fades. */}
              <AnimatePresence initial={false} mode="popLayout">
                <Show when={isOpen(index())}>
                  <w.div class="faq-answer" layout="position" {...answer}>
                    <p>{item.answer}</p>
                  </w.div>
                </Show>
              </AnimatePresence>
            </w.li>
          )}
        </For>
      </ul>
    </div>
  )
}
