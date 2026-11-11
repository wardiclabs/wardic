import { AnimatePresence, domMax, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

type Kind = "Fruit" | "Veg" | "Herbs"
const FRUIT = ["Apple", "Pear", "Plum", "Fig", "Kiwi", "Lime", "Lemon", "Mango", "Peach", "Cherry", "Grape", "Melon", "Apricot", "Banana", "Orange", "Quince"]
const VEG = ["Leek", "Kale", "Okra", "Pea", "Bean", "Beet", "Carrot", "Celery", "Chard", "Corn", "Cress", "Onion", "Potato", "Radish", "Squash", "Turnip"]
const HERBS = ["Basil", "Bay", "Chive", "Dill", "Fennel", "Lovage", "Anise", "Mint", "Borage", "Parsley", "Savory", "Sage", "Sorrel", "Hyssop", "Thyme", "Chervil"]
/** 48 items, the kinds mixed. */
const PRODUCE = FRUIT.flatMap((_, k) => [
  { name: FRUIT[k], kind: "Fruit" as Kind },
  { name: VEG[k], kind: "Veg" as Kind },
  { name: HERBS[k], kind: "Herbs" as Kind },
])
const FILTERS = ["All", "Fruit", "Veg", "Herbs"] as const

const SPRING = { type: "spring", visualDuration: 0.45, bounce: 0.2 } as const

/** A pantry filtered by kind: the items filtered out play their exit, the rest move to their new places. */
export default function Pantry() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All")
  const shown = PRODUCE.filter((item) => filter === "All" || item.kind === filter)
  return (
    // The rest close the gap with `layout`, so this page brings `domMax`, Motion's layout and drag, itself.
    <LazyMotion features={domMax}>
      <div className="sample-stack">
        <div className="sample-tabs sample-filters" role="group" aria-label="Show">
          {FILTERS.map((name) => (
            <button key={name} className="sample-tab" aria-pressed={filter === name} onClick={() => setFilter(name)}>
              {name}
            </button>
          ))}
        </div>
        <div className="sample-pantry-grid">
          {/* popLayout takes a leaving item out of the grid at once, so the rest move as it goes. */}
          <AnimatePresence mode="popLayout">
            {shown.map((item) => (
              <m.div
                key={item.name}
                className="sample-produce"
                data-kind={item.kind}
                layout
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.2 } }}
                transition={SPRING}
              >
                {item.name}
              </m.div>
            ))}
          </AnimatePresence>
        </div>
        <p className="sample-note">
          {shown.length} of {PRODUCE.length}
        </p>
      </div>
    </LazyMotion>
  )
}
