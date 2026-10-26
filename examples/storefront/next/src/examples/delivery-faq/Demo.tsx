"use client"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

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
// spring that swings past and back, which a chevron shouldn't. With no `type`, a `duration` makes a
// tween, eased out.
const chevron = { shut: { rotate: 0 }, open: { rotate: 180 } } as const

export default function DeliveryFaq() {
  const [open, setOpen] = useState(0)

  return (
    <ul className="faq">
      {QUESTIONS.map((item, index) => (
        // Each item grows as its answer opens: layout animates its size, its rounded corners and
        // shadow kept as they are while it scales, and the items below slide down to make room.
        <motion.li key={item.question} className="faq-item" layout>
          <motion.button className="faq-question" layout="position" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}>
            <span>{item.question}</span>
            {/* initial={false}: the answer open when the page loads has its chevron turned already. */}
            <motion.span className="chevron" variants={chevron} initial={false} animate={open === index ? "open" : "shut"} transition={{ duration: 0.2 }} aria-hidden="true">
              ⌄
            </motion.span>
          </motion.button>
          {/* popLayout: a closing answer leaves the flow at once, so its card shrinks while it fades. */}
          <AnimatePresence initial={false} mode="popLayout">
            {open === index && (
              <motion.div className="faq-answer" layout="position" {...answer}>
                <p>{item.answer}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.li>
      ))}
    </ul>
  )
}
