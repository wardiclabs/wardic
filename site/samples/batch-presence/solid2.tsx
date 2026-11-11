import { AnimatePresence, createBatch, stagger } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For } from "solid-js"

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

const COLUMNS = 6
/** The `i`th place in the grid. */
const placeOf = (i: number) => ({ x: (i % COLUMNS) * 48, y: Math.floor(i / COLUMNS) * 30 })

/** A pantry filtered by kind: the items filtered out play their exit, the rest move to their new places. */
export default function Pantry() {
  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>("All")
  const shown = createMemo(() => PRODUCE.filter((item) => filter() === "All" || item.kind === filter()))
  const items = createBatch({
    each: shown,
    key: "name",
    initial: (_, i) => ({ ...placeOf(i), scale: 0.6, opacity: 0 }),
    animate: (_, i) => ({ ...placeOf(i), scale: 1, opacity: 1 }),
    transition: { type: "spring", visualDuration: 0.45, bounce: 0.2 },
    // stagger() counts the items leaving together.
    exit: { scale: 0.6, opacity: 0, transition: { duration: 0.2, delay: stagger(0.015) } },
  })
  return (
    <div class="sample-stack">
      <div class="sample-tabs sample-filters" role="group" aria-label="Show">
        <For each={FILTERS}>
          {(name) => (
            <button class="sample-tab" aria-pressed={filter() === name ? "true" : "false"} onClick={() => setFilter(name)}>
              {name}
            </button>
          )}
        </For>
      </div>
      <div class="sample-pantry">
        {/* A leaving item's element stays until its exit lands. */}
        <AnimatePresence>
          <For each={shown()}>
            {(item) => (
              <div class="sample-produce" data-kind={item.kind} {...items.member(item.name)}>
                {item.name}
              </div>
            )}
          </For>
        </AnimatePresence>
      </div>
      <p class="sample-note">
        {shown().length} of {PRODUCE.length}
      </p>
    </div>
  )
}
