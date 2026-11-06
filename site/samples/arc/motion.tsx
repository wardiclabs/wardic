import { arc } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

// One arc, made once: with no `direction`, each trip keeps to the same side of the screen.
// `y: 0` as well: a toss caught mid-air curves back down to the line, not to where it was caught.
const toss = arc({ strength: 0.6 })

/** A ball tossed across along a curve, and back. */
export default function Arc() {
  const [across, setAcross] = useState(false)
  return (
    <div className="sample-stack">
      <button className="sample-button" onClick={() => setAcross(!across)}>
        Toss
      </button>
      <div className="sample-track">
        <m.div className="sample-ball" animate={{ x: across ? 240 : 0, y: 0 }} transition={{ path: toss, duration: 0.7, ease: "easeInOut" }} />
      </div>
    </div>
  )
}
