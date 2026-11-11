import { createBatch } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal, For } from "solid-js"

const COLUMNS = 12
const STEP = 24
const SWATCHES: ReadonlyArray<number> = Array.from({ length: 96 }, (_, i) => i)

const colX = (i: number) => (i % COLUMNS) * STEP
const rowY = (i: number) => Math.floor(i / COLUMNS) * STEP
/** Swatch `i`'s hue, across the aurora. */
const hueOf = (i: number) => Math.round(150 + i * 2.2)

/** A palette of 96 swatches in one Batch: each lifts under the pointer, presses down, and a tap picks it. */
export default function Palette() {
  const [picked, setPicked] = createSignal<number>()
  const swatches = createBatch({
    count: SWATCHES.length,
    initial: false,
    animate: (i) => ({ x: colX(i), y: rowY(i), scale: 1 }),
    // A function, since `y` is where the swatch sits: it lifts from its own row.
    whileHover: (i) => ({ scale: 1.25, y: rowY(i) - 3 }),
    whileTap: { scale: 0.9 },
  })
  // Every swatch's tap, heard from one set of listeners.
  createEffect(swatches.when("tap"), ({ i }) => {
    setPicked(hueOf(i))
  })
  return (
    <div class="sample-stack">
      <div class="sample-palette">
        <For each={SWATCHES}>
          {(i) => (
            <button
              class="sample-swatch"
              aria-label={`Hue ${hueOf(i)}°`}
              aria-pressed={picked() === hueOf(i) ? "true" : "false"}
              {...swatches.at(i, { style: { background: `hsl(${hueOf(i)} 60% 62%)` } })}
            />
          )}
        </For>
      </div>
      <p class="sample-note">{picked() === undefined ? "Tap a swatch" : `Picked: hue ${picked()}°`}</p>
    </div>
  )
}
