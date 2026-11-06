import * as m from "motion/react-m"
import { useState } from "react"

/** One toggle, three ways to get there: a spring, a tween, and keyframes. */
export default function Transitions() {
  const [moved, setMoved] = useState(false)
  return (
    <div className="sample-stack">
      <button className="sample-button" onClick={() => setMoved(!moved)}>
        Move
      </button>
      <m.div className="sample-box" animate={{ x: moved ? 160 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
        spring
      </m.div>
      <m.div className="sample-box" animate={{ x: moved ? 160 : 0 }} transition={{ duration: 0.6, ease: "easeInOut" }}>
        tween
      </m.div>
      <m.div className="sample-box" initial={false} animate={{ x: moved ? [0, 200, 160] : [160, -40, 0] }} transition={{ duration: 0.8, times: [0, 0.6, 1] }}>
        keyframes
      </m.div>
    </div>
  )
}
