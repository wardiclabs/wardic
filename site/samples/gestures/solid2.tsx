import { w } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal } from "solid-js"

/** A button that answers hover, press and keyboard focus, and counts its taps. */
export default function Gestures() {
  const [taps, setTaps] = createSignal(0)
  // A ward that only listens: the button's own props animate it, and this hears its taps.
  const button = w.ward()
  createEffect(button.when("tap"), () => {
    setTaps((count) => count + 1)
  })
  return (
    <div class="sample-stack">
      <w.button class="sample-button" wardRef={button} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} whileFocus={{ y: -2 }}>
        Tap me
      </w.button>
      <p class="sample-note">Tapped {taps()} times</p>
    </div>
  )
}
