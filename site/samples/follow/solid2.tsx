import { createSpring } from "@wardic/solid/unstable/v2"
import { w } from "~/lib/wardic.ts"
import { createEffect, createSignal } from "solid-js"

/** A dot that follows the pointer: the pointer sets two signals, and two springs follow them. */
export default function Follow() {
  const [x, setX] = createSignal(0)
  const [y, setY] = createSignal(0)
  const springX = createSpring(x, { stiffness: 300, damping: 20 })
  const springY = createSpring(y, { stiffness: 300, damping: 20 })
  // A ward that only listens: it hears the pointer over the field, where it comes in and at each move.
  const field = w.ward()
  createEffect(field.when("hover"), ({ point, element }) => {
    const box = element.getBoundingClientRect()
    setX(point.x - box.left - 20)
    setY(point.y - box.top - 20)
  })
  return (
    <w.div class="sample-field" wardRef={field}>
      <w.div class="sample-dot" style={{ x: springX, y: springY }} />
    </w.div>
  )
}
