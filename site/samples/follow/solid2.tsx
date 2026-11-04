import { createSpring, w } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"

/** A dot that follows the pointer: the pointer sets two signals, and two springs follow them. */
export default function Follow() {
  const [x, setX] = createSignal(0)
  const [y, setY] = createSignal(0)
  const springX = createSpring(x, { stiffness: 300, damping: 20 })
  const springY = createSpring(y, { stiffness: 300, damping: 20 })
  const follow = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const box = event.currentTarget.getBoundingClientRect()
    setX(event.clientX - box.left - 20)
    setY(event.clientY - box.top - 20)
  }
  return (
    <div class="sample-field" onPointerMove={follow}>
      <w.div class="sample-dot" style={{ x: springX, y: springY }} />
    </div>
  )
}
