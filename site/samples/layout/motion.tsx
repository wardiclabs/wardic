import { domMax, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

/** A switch: the stylesheet moves its knob across, and `layout` animates the move. */
export default function Switch() {
  const [on, setOn] = useState(false)
  return (
    // This page lays out, so it brings `domMax`, Motion's layout and drag, itself: pages that don't never load it.
    <LazyMotion features={domMax}>
      <button className="sample-switch" role="switch" aria-checked={on} aria-label="Lights" onClick={() => setOn(!on)}>
        <m.span className="sample-knob" layout transition={{ type: "spring", stiffness: 500, damping: 30 }} />
      </button>
    </LazyMotion>
  )
}
