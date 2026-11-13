import { AnimatePresence, w } from "@wardic/solid"
import { createSignal, Show } from "solid-js"

/** Each icon turns in a quarter turn from half its size, and turns out the same way on. */
const TURN = {
  initial: { opacity: 0, scale: 0.5, rotate: -90 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.5, rotate: 90 },
  transition: { type: "spring", visualDuration: 0.3, bounce: 0.3 },
} as const

/** A play button whose icon swaps for a pause one: each icon an `<svg>`, the leaving one popped out of the flow. */
export default function PlayButton() {
  const [playing, setPlaying] = createSignal(false)
  return (
    <div class="sample-stack">
      <button class="sample-button sample-icon-button" aria-label={playing() ? "Pause" : "Play"} onClick={() => setPlaying((on) => !on)}>
        {/* The leaving icon is popped: it turns out over the new one, not beside it, and the button keeps its size. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <Show
            when={playing()}
            fallback={
              <w.svg viewBox="0 0 24 24" width="22" height="22" initial={TURN.initial} animate={TURN.animate} exit={TURN.exit} transition={TURN.transition}>
                <path d="M7 5 L19 12 L7 19 Z" />
              </w.svg>
            }
          >
            <w.svg viewBox="0 0 24 24" width="22" height="22" initial={TURN.initial} animate={TURN.animate} exit={TURN.exit} transition={TURN.transition}>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </w.svg>
          </Show>
        </AnimatePresence>
      </button>
      <p class="sample-note">{playing() ? "Playing" : "Paused"}</p>
    </div>
  )
}
