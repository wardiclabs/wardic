import { motion } from "motion/react"
import { useState } from "react"

const TABS = ["Bowls", "Plates", "Cups"]

/** Tabs with one underline: each tab's has the same `layoutId`, so it flies to the tab that's picked. */
export default function Tabs() {
  const [picked, setPicked] = useState("Bowls")
  return (
    <div className="sample-tabs" role="tablist" aria-label="Shelves">
      {TABS.map((name) => (
        <button key={name} className="sample-tab" role="tab" aria-selected={picked === name} onClick={() => setPicked(name)}>
          {name}
          {picked === name && <motion.span className="sample-underline" layoutId="underline" />}
        </button>
      ))}
    </div>
  )
}
