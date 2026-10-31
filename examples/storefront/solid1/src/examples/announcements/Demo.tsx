import { AnimatePresence, createAnimationFrame, createCycle, createPageInView, wardic } from "@wardic/solid"
import { createSignal, Show } from "solid-js"

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
  const [current, next] = createCycle(...MESSAGES)
  // Whether the page is shown: a tab in the background spends no time on messages nobody sees.
  const visible = createPageInView()
  const [hovered, setHovered] = createSignal(false)
  const [held, setHeld] = createSignal(false)
  // How far the message is through its time, 0 to 1: the bar under it, as a live value.
  const [progress, setProgress] = createSignal(0)
  let shown = 0

  const step = () => {
    shown = 0
    setProgress(0)
    next()
  }

  // Each frame, the message's time runs on by the frame's own `delta`, but only while someone can
  // read it: not while the page is hidden, the pointer rests on it, or it's paused.
  createAnimationFrame((_, delta) => {
    if (!visible() || hovered() || held()) return
    shown += delta
    if (shown >= HOLD) step()
    else setProgress(shown / HOLD)
  })

  return (
    <div class="announcements" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div class="announcement">
        <AnimatePresence mode="wait">
          {/* keyed: each message is a new child, so the last one leaves before the next enters. */}
          <Show when={current()} keyed>
            {(text) => (
              <wardic.p class="announcement-message" {...message}>
                {text}
              </wardic.p>
            )}
          </Show>
        </AnimatePresence>
      </div>
      <wardic.div class="announcement-bar" style={{ scaleX: progress }} />
      <div class="announcement-controls">
        <button type="button" class="button quiet" aria-pressed={String(held()) as "true" | "false"} onClick={() => setHeld(!held())}>
          {held() ? "Play" : "Pause"}
        </button>
        <button type="button" class="button quiet" onClick={step}>
          Next
        </button>
      </div>
    </div>
  )
}
