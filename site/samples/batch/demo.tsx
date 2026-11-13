/**
 * The Batch guide's grid demo: the Shuffle sample, one Batch of 1,000 tiles, which also draws Wardic's
 * mark, as a mosaic or in lines (logo.ts). Each drawing is one change of the Batch's targets, as a
 * shuffle is. Not a code tab: the tabs show the bindings' files.
 */
import { createBatch, stagger } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal, For, isPending, onSettled } from "solid-js"
import { framesPerSecond } from "../frames.ts"
import { BOARD, gridAt, LINES, MOSAIC, TILE_COUNT } from "./logo.ts"

const TILES: ReadonlyArray<number> = Array.from({ length: TILE_COUNT }, (_, id) => id)

type Drawing = "grid" | "mosaic" | "lines"

const DRAWINGS: ReadonlyArray<{ readonly drawing: Drawing; readonly label: string }> = [
  { drawing: "grid", label: "Grid" },
  { drawing: "mosaic", label: "Mosaic" },
  { drawing: "lines", label: "Lines" },
]

/** A tile's colour in each drawing. */
const COLOURS: Readonly<Record<Drawing, (id: number) => string>> = {
  grid: (id) => `hsl(${190 + id * 0.15} 60% 62%)`,
  mosaic: (id) => MOSAIC[id].color,
  lines: (id) => LINES[id].color,
}

const shuffled = (ids: ReadonlyArray<number>): ReadonlyArray<number> => {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export default function Demo() {
  const [order, setOrder] = createSignal(TILES)
  const [drawing, setDrawing] = createSignal<Drawing>("grid")
  const [fps, setFps] = createSignal<number>()
  onSettled(() => framesPerSecond(setFps))
  // In every drawing, a tile's place is its index in the order: a cell of the grid, or a cell of the mark.
  // Its colour is its own (`COLOURS`, by its id), so in order the mark is whole, and shuffled it's scrambled
  // until Sort puts it back together.
  const tiles = createBatch({
    each: order,
    key: (id) => id,
    initial: (_, i) => ({ ...gridAt(i), scale: 0, rotate: 0, opacity: 0 }),
    animate: (_, i) => {
      const now = drawing()
      if (now === "mosaic") return MOSAIC[i].values
      if (now === "lines") return LINES[i].values
      return { ...gridAt(i), scale: 1, rotate: 0, opacity: 1 }
    },
    transition: { type: "spring", visualDuration: 0.6, bounce: 0.2, delay: stagger(0.0004) },
  })
  // Each tile's colour, written onto its element as the drawing changes, a step at its own delay
  // (site.css). Not as custom properties for CSS to pick from: a tile restyled each frame it moves
  // resolves them again, about twice the style work of the move itself.
  const tileElements: Array<HTMLDivElement> = []
  createEffect(drawing, (now) => {
    const colourOf = COLOURS[now]
    tileElements.forEach((el, id) => el.style.setProperty("background-color", colourOf(id)))
  })
  const sorted = () => order() === TILES
  // Shuffle and Sort reorder the tiles in whichever drawing is up: a new order, each tile to its new place.
  const reorder = () => setOrder(sorted() ? shuffled(TILES) : TILES)
  return (
    <div class="sample-stack">
      <div class="sample-tabs" role="group" aria-label="The tiles draw">
        <For each={DRAWINGS}>
          {(choice) => (
            <button class="sample-tab" aria-pressed={drawing() === choice.drawing ? "true" : "false"} onClick={() => setDrawing(choice.drawing)}>
              {choice.label}
            </button>
          )}
        </For>
      </div>
      <button class="sample-button" onClick={reorder}>
        {sorted() ? "Shuffle" : "Sort"}
      </button>
      <div class="sample-tiles sample-logo" style={{ width: `${BOARD.width}px`, height: `${BOARD.height}px` }}>
        <For each={TILES}>
          {(id) => (
            <div
              class="sample-tile"
              {...tiles.member(id, {
                ref: (el: HTMLDivElement) => {
                  tileElements[id] = el
                },
                style: { background: COLOURS.grid(id), "transition-delay": `${id * 0.4}ms` },
              })}
            />
          )}
        </For>
      </div>
      <p class="sample-note">
        1,000 tiles · {isPending(() => tiles.settled()) ? "Moving…" : "Ready"} · {fps() ?? "–"} fps
      </p>
    </div>
  )
}
