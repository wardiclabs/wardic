import { domAnimation, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

const COLUMNS = 12
const STEP = 24
const SWATCHES: ReadonlyArray<number> = Array.from({ length: 96 }, (_, i) => i)

const colX = (i: number) => (i % COLUMNS) * STEP
const rowY = (i: number) => Math.floor(i / COLUMNS) * STEP
/** Swatch `i`'s hue, across the aurora. */
const hueOf = (i: number) => Math.round(150 + i * 2.2)

/** A palette of 96 swatches: each lifts under the pointer, presses down, and a tap picks it. */
export default function Palette() {
  const [picked, setPicked] = useState<number>()
  return (
    <LazyMotion features={domAnimation}>
      <div className="sample-stack">
        <div className="sample-palette">
          {/* Each swatch listens for itself. */}
          {SWATCHES.map((i) => (
            <m.button
              key={i}
              className="sample-swatch"
              aria-label={`Hue ${hueOf(i)}°`}
              aria-pressed={picked === hueOf(i)}
              style={{ x: colX(i), y: rowY(i), background: `hsl(${hueOf(i)} 60% 62%)` }}
              whileHover={{ scale: 1.25, y: rowY(i) - 3 }}
              whileTap={{ scale: 0.9 }}
              onTap={() => setPicked(hueOf(i))}
            />
          ))}
        </div>
        <p className="sample-note">{picked === undefined ? "Tap a swatch" : `Picked: hue ${picked}°`}</p>
      </div>
    </LazyMotion>
  )
}
