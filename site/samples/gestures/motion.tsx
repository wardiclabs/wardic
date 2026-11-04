import { motion } from "motion/react"
import { useState } from "react"

/** A button that answers hover, press and keyboard focus, and counts its taps. */
export default function Gestures() {
  const [taps, setTaps] = useState(0)
  return (
    <div className="sample-stack">
      <motion.button className="sample-button" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} whileFocus={{ y: -2 }} onTap={() => setTaps((count) => count + 1)}>
        Tap me
      </motion.button>
      <p className="sample-note">Tapped {taps} times</p>
    </div>
  )
}
