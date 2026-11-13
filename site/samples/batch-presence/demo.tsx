/**
 * The Batch guide's "Items that come and go" demo: the sample's pantry of 102 items, or, as a test, 612 (each
 * item six times, its kind kept) in a scroller, with the page's frame rate. The bigger pantry is the demo's
 * alone: the code tabs show the sample.
 */
import { AnimatePresence, createBatch, stagger } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { framesPerSecond } from "../frames.ts"
import Pantry, { FILTERS, PRODUCE } from "./solid2.tsx"

const COPIES = 6
/** Each item six times, keyed apart, the kinds as mixed as the sample's: 612. */
const MANY = Array.from({ length: COPIES }, (_, c) => PRODUCE.map((item) => ({ ...item, id: `${item.name} ${c + 1}` }))).flat()

type Size = "sample" | "many"
const SIZES: ReadonlyArray<{ readonly size: Size; readonly label: string }> = [
  { size: "sample", label: `${PRODUCE.length} items` },
  { size: "many", label: `${MANY.length} items` },
]

const COLUMNS = 6
/** The `i`th place in the grid, the sample's. */
const placeOf = (i: number) => ({ x: (i % COLUMNS) * 48, y: Math.floor(i / COLUMNS) * 30 })
/** The board as tall as every item needs, so the scroller keeps its length as items come and go. */
const HEIGHT = Math.ceil(MANY.length / COLUMNS) * 30

/** The sample's pantry at 612: the same Batch, its exits' stagger spread over the leavers as the sample's is over 102. */
function ManyPantry() {
  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>("All")
  const [fps, setFps] = createSignal<number>()
  onSettled(() => framesPerSecond(setFps))
  const shown = createMemo(() => MANY.filter((item) => filter() === "All" || item.kind === filter()))
  const items = createBatch({
    each: shown,
    key: "id",
    initial: (_, i) => ({ ...placeOf(i), scale: 0.6, opacity: 0 }),
    animate: (_, i) => ({ ...placeOf(i), scale: 1, opacity: 1 }),
    transition: { type: "spring", visualDuration: 0.45, bounce: 0.2 },
    // The sample's 0.007 s a leaving item, over six times the items: the same half second or so in all.
    exit: { scale: 0.6, opacity: 0, transition: { duration: 0.2, delay: stagger(0.007 / COPIES) } },
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
      <div class="sample-pantry-scroll">
        <div class="sample-pantry" style={{ height: `${HEIGHT}px` }}>
          <AnimatePresence>
            <For each={shown()}>
              {(item) => (
                <div class="sample-produce" data-kind={item.kind} {...items.member(item.id)}>
                  {item.name}
                </div>
              )}
            </For>
          </AnimatePresence>
        </div>
      </div>
      <p class="sample-note">
        {shown().length} of {MANY.length} · {fps() ?? "–"} fps
      </p>
    </div>
  )
}

export default function Demo() {
  const [size, setSize] = createSignal<Size>("sample")
  return (
    <div class="sample-stack">
      <div class="sample-tabs" role="group" aria-label="How many items">
        <For each={SIZES}>
          {(choice) => (
            <button class="sample-tab" aria-pressed={size() === choice.size ? "true" : "false"} onClick={() => setSize(choice.size)}>
              {choice.label}
            </button>
          )}
        </For>
      </div>
      <Show when={size() === "many"} fallback={<Pantry />}>
        <ManyPantry />
      </Show>
    </div>
  )
}
