import { w } from "~/lib/wardic.ts"
import { createSignal } from "solid-js"

/** A button that answers hover, press and keyboard focus, and counts its taps. */
export default function Gestures() {
  const [taps, setTaps] = createSignal(0)
  return (
    <div class="sample-stack">
      <w.button class="sample-button" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} whileFocus={{ y: -2 }} onTap={() => setTaps(taps() + 1)}>
        Tap me
      </w.button>
      <p class="sample-note">Tapped {taps()} times</p>
    </div>
  )
}
