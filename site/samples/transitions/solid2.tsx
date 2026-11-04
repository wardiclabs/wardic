import { w } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"

/** One toggle, three ways to get there: a spring, a tween, and keyframes. */
export default function Transitions() {
  const [moved, setMoved] = createSignal(false)
  return (
    <div class="sample-stack">
      <button class="sample-button" onClick={() => setMoved(!moved())}>
        Move
      </button>
      <w.div class="sample-box" animate={{ x: moved() ? 160 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
        spring
      </w.div>
      <w.div class="sample-box" animate={{ x: moved() ? 160 : 0 }} transition={{ duration: 0.6, ease: "easeInOut" }}>
        tween
      </w.div>
      <w.div class="sample-box" animate={{ x: moved() ? [0, 200, 160] : [160, -40, 0] }} transition={{ duration: 0.8, times: [0, 0.6, 1] }}>
        keyframes
      </w.div>
    </div>
  )
}
