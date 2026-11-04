import { AnimatePresence, layout, LazyWardic, w } from "@wardic/solid"
import { createSignal, For } from "solid-js"

/** Chips that pop in and out: each plays its `exit` before it goes, and the rest close the gap. */
export default function Chips() {
  const [chips, setChips] = createSignal([1, 2, 3])
  let next = 4
  const add = () => setChips((all) => [...all, next++])
  const remove = (chip: number) => setChips((all) => all.filter((one) => one !== chip))
  return (
    <LazyWardic features={[layout]}>
      <div class="sample-stack">
        <button class="sample-button" onClick={add}>
          Add
        </button>
        <ul class="sample-chips">
          {/* popLayout takes a leaving chip out of the row at once, so the rest move up as it goes. */}
          <AnimatePresence mode="popLayout">
            <For each={chips()}>
              {(chip) => (
                <w.li class="sample-chip" layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
                  <button aria-label={`Remove ${chip}`} onClick={() => remove(chip)}>
                    {chip} ×
                  </button>
                </w.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </div>
    </LazyWardic>
  )
}
