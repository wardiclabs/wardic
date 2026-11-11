import { createBatch } from "@wardic/solid"
import { createSignal, For } from "solid-js"

const COLUMNS = 12
const STEP = 24
const SWATCHES: ReadonlyArray<number> = Array.from({ length: 120 }, (_, i) => i)

const colX = (i: number) => (i % COLUMNS) * STEP
const rowY = (i: number) => Math.floor(i / COLUMNS) * STEP
/** Swatch `i`'s hue, across the aurora. */
const hueOf = (i: number) => Math.round(150 + i * 1.75)
/** A swatch's scale near the hovered one: 1.25 on it, less with each cell away, 1 from three cells. */
const scaleNear = (i: number, hovered: number | undefined) => {
  if (hovered === undefined) return 1
  const cells = Math.hypot((i % COLUMNS) - (hovered % COLUMNS), Math.floor(i / COLUMNS) - Math.floor(hovered / COLUMNS))
  return 1 + 0.25 * Math.max(0, 1 - cells / 3)
}

/** A palette of 120 swatches in one Batch: the hovered one lifts, its neighbours grow with it, a press shrinks it, a tap picks it. */
export default function Palette() {
  const [picked, setPicked] = createSignal<number>()
  const [hovered, setHovered] = createSignal<number>()
  const swatches = createBatch({
    count: SWATCHES.length,
    initial: false,
    // Every swatch scales by its distance from the hovered one: a new hover is one change for all 120.
    animate: (i) => ({ x: colX(i), y: rowY(i), scale: scaleNear(i, hovered()) }),
    // The hovered one lifts from its own row: a function, since `y` is where a swatch sits.
    whileHover: (i) => ({ y: rowY(i) - 3 }),
    whileTap: { scale: 0.9 },
    // Every swatch's hover and tap, heard from one set of listeners.
    onHoverStart: (_, { i }) => setHovered(i),
    onTap: (_, { i }) => setPicked(hueOf(i)),
  })
  return (
    <div class="sample-stack">
      <div class="sample-palette" onPointerLeave={() => setHovered(undefined)}>
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
