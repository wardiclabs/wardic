import { createBatch, stagger } from "@wardic/solid/unstable/v2"
import { createSignal, For, isPending, onSettled } from "solid-js"
import { framesPerSecond } from "../frames.ts"

const COLUMNS = 40
const STEP = 7
const TILES: ReadonlyArray<number> = Array.from({ length: 1000 }, (_, id) => id)

/** The `i`th place in the grid. */
const placeOf = (i: number) => ({ x: (i % COLUMNS) * STEP, y: Math.floor(i / COLUMNS) * STEP })

const shuffled = (ids: ReadonlyArray<number>): ReadonlyArray<number> => {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A thousand tiles in one Batch: each order sends every tile to its new place in one change. */
export default function Tiles() {
  const [order, setOrder] = createSignal(TILES)
  const [fps, setFps] = createSignal<number>()
  onSettled(() => framesPerSecond(setFps))
  // Keyed by tile, so a new order moves each tile from where it is, at the speed it has.
  const tiles = createBatch({
    each: order,
    key: (id) => id,
    initial: (_, i) => ({ ...placeOf(i), scale: 0, opacity: 0 }),
    animate: (_, i) => ({ ...placeOf(i), scale: 1, opacity: 1 }),
    // stagger() counts the tiles a change moves.
    transition: { type: "spring", visualDuration: 0.6, bounce: 0.2, delay: stagger(0.0004) },
  })
  const sorted = () => order() === TILES
  return (
    <div class="sample-stack">
      <button class="sample-button" onClick={() => setOrder(sorted() ? shuffled(TILES) : TILES)}>
        {sorted() ? "Shuffle" : "Sort"}
      </button>
      <div class="sample-tiles">
        <For each={TILES}>{(id) => <div class="sample-tile" {...tiles.member(id, { style: { background: `hsl(${190 + id * 0.15} 60% 62%)` } })} />}</For>
      </div>
      <p class="sample-note">
        1,000 tiles · {isPending(() => tiles.settled()) ? "Moving…" : "Ready"} · {fps() ?? "–"} fps
      </p>
    </div>
  )
}
