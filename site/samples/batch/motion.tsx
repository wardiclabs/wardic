import { animate } from "motion/react"
import { useEffect, useRef, useState } from "react"
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

const SPRING = { type: "spring", visualDuration: 0.6, bounce: 0.2 } as const

/** A thousand tiles: each order sends every tile to its new place, an animation per tile. */
export default function Tiles() {
  const tiles = useRef<Array<HTMLDivElement | null>>([])
  const entered = useRef(false)
  const runs = useRef(0)
  const [order, setOrder] = useState(TILES)
  const [moving, setMoving] = useState(false)
  const [fps, setFps] = useState<number>()
  useEffect(() => framesPerSecond(setFps), [])
  // Motion has no Batch: each tile runs on its own, staggered by its place.
  useEffect(() => {
    const run = ++runs.current
    setMoving(true)
    const moves = order.map((id, i) => {
      const tile = tiles.current[id]
      if (tile === null || tile === undefined) return undefined
      const { x, y } = placeOf(i)
      // Its entrance, from nothing at its place; after it, from where it is.
      const to = entered.current ? { x, y } : { x: [x, x], y: [y, y], scale: [0, 1], opacity: [0, 1] }
      return animate(tile, to, { ...SPRING, delay: i * 0.0004 })
    })
    entered.current = true
    Promise.all(moves).then(() => {
      if (run === runs.current) setMoving(false)
    })
  }, [order])
  const sorted = order === TILES
  return (
    <div className="sample-stack">
      <button className="sample-button" onClick={() => setOrder(sorted ? shuffled(TILES) : TILES)}>
        {sorted ? "Shuffle" : "Sort"}
      </button>
      <div className="sample-tiles">
        {TILES.map((id) => (
          <div
            key={id}
            className="sample-tile"
            ref={(tile) => {
              tiles.current[id] = tile
            }}
            style={{ background: `hsl(${190 + id * 0.15} 60% 62%)`, opacity: 0 }}
          />
        ))}
      </div>
      <p className="sample-note">
        1,000 tiles · {moving ? "Moving…" : "Ready"} · {fps ?? "–"} fps
      </p>
    </div>
  )
}
