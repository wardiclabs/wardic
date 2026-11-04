import { AnimatePresence, motion } from "motion/react"
import { useRef, useState } from "react"

/** Chips that pop in and out: each plays its `exit` before it goes, and the rest close the gap. */
export default function Chips() {
  const [chips, setChips] = useState([1, 2, 3])
  const next = useRef(4)
  const add = () => setChips((all) => [...all, next.current++])
  const remove = (chip: number) => setChips((all) => all.filter((one) => one !== chip))
  return (
    <div className="sample-stack">
      <button className="sample-button" onClick={add}>
        Add
      </button>
      <ul className="sample-chips">
        {/* popLayout takes a leaving chip out of the row at once, so the rest move up as it goes. */}
        <AnimatePresence mode="popLayout">
          {chips.map((chip) => (
            <motion.li key={chip} className="sample-chip" layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
              <button aria-label={`Remove ${chip}`} onClick={() => remove(chip)}>
                {chip} ×
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
