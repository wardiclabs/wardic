"use client"
import { m } from "motion/react"
import { useRef, useState } from "react"

const PIECES = [
  { id: "sofa", name: "Sofa", x: 24, y: 24, width: 120, height: 52 },
  { id: "table", name: "Table", x: 64, y: 112, width: 72, height: 44 },
  { id: "lamp", name: "Lamp", x: 236, y: 32, width: 44, height: 44 },
] as const

// Motion's Features are the whole page's: the app's `LazyMotion` loads `domMax`, which the cart's
// fly-in needs for `layoutId`, and `drag` comes in it. So the room drags at once, and Rearrange has
// nothing to load.
export default function Rearrange() {
  const plan = useRef<HTMLDivElement>(null)
  const [pressed, setPressed] = useState(false)

  return (
    <div className="room-demo">
      <div className="lazy-bar">
        <button className="button accent rearrange" disabled={pressed} onClick={() => setPressed(true)}>
          Rearrange
        </button>
        <output className="lazy-status" aria-live="polite">
          {pressed ? (
            <>
              Nothing to load: Motion&apos;s Features are the whole page&apos;s.
            </>
          ) : (
            <>
              <code>drag</code> came with the page, in the shell&apos;s <code>domMax</code>.
            </>
          )}
        </output>
      </div>
      <div className="room-frame">
        <div className="room-plan" ref={plan} data-drag="arrived">
          {PIECES.map((piece) => (
            <m.div
              key={piece.id}
              className="room-piece"
              data-id={piece.id}
              drag
              dragConstraints={plan}
              dragElastic={0.1}
              dragMomentum={false}
              whileDrag={{ scale: 1.05 }}
              style={{ left: piece.x, top: piece.y, width: piece.width, height: piece.height }}
            >
              {piece.name}
            </m.div>
          ))}
        </div>
      </div>
    </div>
  )
}
