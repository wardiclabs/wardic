import { AnimatePresence, domAnimation, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

/** Each icon turns in a quarter turn from half its size, and turns out the same way on. */
const TURN = {
  initial: { opacity: 0, scale: 0.5, rotate: -90 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.5, rotate: 90 },
  transition: { type: "spring", visualDuration: 0.3, bounce: 0.3 },
} as const

/** A play button whose icon swaps for a pause one, the leaving one popped out of the flow. */
export default function PlayButton() {
  const [playing, setPlaying] = useState(false)
  return (
    <LazyMotion features={domAnimation}>
      <div className="sample-stack">
        <button className="sample-button sample-icon-button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((on) => !on)}>
          {/* Motion pops only an HTML element, so each icon turns in an `m.span` around its `<svg>`. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {playing ? (
              <m.span key="pause" className="sample-icon" initial={TURN.initial} animate={TURN.animate} exit={TURN.exit} transition={TURN.transition}>
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              </m.span>
            ) : (
              <m.span key="play" className="sample-icon" initial={TURN.initial} animate={TURN.animate} exit={TURN.exit} transition={TURN.transition}>
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path d="M7 5 L19 12 L7 19 Z" />
                </svg>
              </m.span>
            )}
          </AnimatePresence>
        </button>
        <p className="sample-note">{playing ? "Playing" : "Paused"}</p>
      </div>
    </LazyMotion>
  )
}
