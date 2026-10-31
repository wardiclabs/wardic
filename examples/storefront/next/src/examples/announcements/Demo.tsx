"use client"
import { AnimatePresence, motion, useAnimationFrame, useCycle, useMotionValue, usePageInView } from "motion/react"
import { useRef, useState } from "react"

const MESSAGES = [
  "Free delivery on orders over £60",
  "New: the Lagoon glaze, fired in small batches",
  "Every piece is wrapped by hand",
  "Free returns within 30 days",
] as const

// How long each message stays, in milliseconds of the page being seen.
const HOLD = 4000

// The message going fades up and out, then the next fades up in (mode="wait").
const message = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "tween", duration: 0.2 },
} as const

export default function Announcements() {
  // One message at a time: `next()` steps to the following one, the first after the last.
  const [current, next] = useCycle(...MESSAGES)
  // Whether the page is shown: a tab in the background spends no time on messages nobody sees.
  const visible = usePageInView()
  const [hovered, setHovered] = useState(false)
  const [held, setHeld] = useState(false)
  // How far the message is through its time, 0 to 1: the bar under it, as a motion value.
  const progress = useMotionValue(0)
  const shown = useRef(0)

  const step = () => {
    shown.current = 0
    progress.set(0)
    next()
  }

  // Each frame, the message's time runs on by the frame's own `delta`, but only while someone can
  // read it: not while the page is hidden, the pointer rests on it, or it's paused.
  useAnimationFrame((_, delta) => {
    if (!visible || hovered || held) return
    shown.current += delta
    if (shown.current >= HOLD) step()
    else progress.set(shown.current / HOLD)
  })

  return (
    <div className="announcements" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="announcement">
        <AnimatePresence mode="wait">
          <motion.p key={current} className="announcement-message" {...message}>
            {current}
          </motion.p>
        </AnimatePresence>
      </div>
      <motion.div className="announcement-bar" style={{ scaleX: progress }} />
      <div className="announcement-controls">
        <button type="button" className="button quiet" aria-pressed={held} onClick={() => setHeld(!held)}>
          {held ? "Play" : "Pause"}
        </button>
        <button type="button" className="button quiet" onClick={step}>
          Next
        </button>
      </div>
    </div>
  )
}
