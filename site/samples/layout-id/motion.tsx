import { domMax, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

const TABS = ["Bowls", "Plates", "Cups"]

/** Tabs with one underline: each tab's has the same `layoutId`, so it flies to the tab that's picked. */
export default function Tabs() {
  const [picked, setPicked] = useState("Bowls")
  return (
    // This page lays out, so it brings `domMax`, Motion's layout and drag, itself: pages that don't never load it.
    <LazyMotion features={domMax}>
      <div className="sample-tabs" role="tablist" aria-label="Shelves">
        {TABS.map((name) => (
          <button key={name} className="sample-tab" role="tab" aria-selected={picked === name} onClick={() => setPicked(name)}>
            {name}
            {picked === name && <m.span className="sample-underline" layoutId="underline" />}
          </button>
        ))}
      </div>
    </LazyMotion>
  )
}
