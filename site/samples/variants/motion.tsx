import { stagger } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

const ITEMS = ["Vases", "Bowls", "Plates", "Jugs"]

// The list names a variant; each item follows it with its own target. The list's transition spaces
// them out: in from the first, out from the last.
const list = {
  open: { transition: { delayChildren: stagger(0.07) } },
  closed: { transition: { delayChildren: stagger(0.05, { from: "last" }) } },
}
const item = {
  open: { opacity: 1, x: 0 },
  closed: { opacity: 0, x: -24 },
}

export default function Variants() {
  const [open, setOpen] = useState(true)
  return (
    <div className="sample-stack">
      <button className="sample-button" onClick={() => setOpen(!open)}>
        {open ? "Close" : "Open"}
      </button>
      <m.ul className="sample-list" variants={list} initial="closed" animate={open ? "open" : "closed"}>
        {ITEMS.map((name) => (
          <m.li key={name} className="sample-item" variants={item}>
            {name}
          </m.li>
        ))}
      </m.ul>
    </div>
  )
}
