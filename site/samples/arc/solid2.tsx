import { arc, w } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"

/** A ball tossed across along a curve, and back. */
export default function Arc() {
  const [across, setAcross] = createSignal(false)
  // One arc, made once: with no `direction`, each trip keeps to the same side of the screen.
  const toss = arc({ strength: 0.6 })
  return (
    <div class="sample-stack">
      <button class="sample-button" onClick={() => setAcross(!across())}>
        Toss
      </button>
      <div class="sample-track">
        <w.div class="sample-ball" animate={{ x: across() ? 240 : 0 }} transition={{ path: toss, duration: 0.7, ease: "easeInOut" }} />
      </div>
    </div>
  )
}
