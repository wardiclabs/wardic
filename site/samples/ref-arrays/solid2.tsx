import { createHover, createPress } from "@wardic/solid"
import { w } from "~/lib/wardic.ts"

/** One button given to a ward and to two sensors at once, through a list of refs. */
export default function RefArrays() {
  const card = w.ward({ whileHover: { scale: 1.05 }, whileTap: { scale: 0.95 } })
  const hovered = createHover()
  const pressed = createPress()
  return (
    <div class="sample-stack">
      <button class="sample-button" type="button" {...card} ref={[card, hovered, pressed]}>
        Press me
      </button>
      <p class="sample-flags">
        <span class={{ on: hovered() }}>Hovered</span>
        <span class={{ on: pressed() }}>Pressed</span>
      </p>
    </div>
  )
}
