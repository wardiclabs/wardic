import { motion } from "motion/react"
import { useState } from "react"

/** A switch: the stylesheet moves its knob across, and `layout` animates the move. */
export default function Switch() {
  const [on, setOn] = useState(false)
  return (
    <button className="sample-switch" role="switch" aria-checked={on} aria-label="Lights" onClick={() => setOn(!on)}>
      <motion.span className="sample-knob" layout transition={{ type: "spring", stiffness: 500, damping: 30 }} />
    </button>
  )
}
