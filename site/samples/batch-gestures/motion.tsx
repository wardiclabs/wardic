import { domAnimation, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

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

/** A palette of 120 swatches: the hovered one lifts, its neighbours grow with it, a press shrinks it, a tap picks it. */
export default function Palette() {
  const [picked, setPicked] = useState<number>()
  const [hovered, setHovered] = useState<number>()
  return (
    <LazyMotion features={domAnimation}>
      <div className="sample-stack">
        <div className="sample-palette" onPointerLeave={() => setHovered(undefined)}>
          {/* Each swatch listens for itself, and each scales by its distance from the hovered one. */}
          {SWATCHES.map((i) => (
            <m.button
              key={i}
              className="sample-swatch"
              aria-label={`Hue ${hueOf(i)}°`}
              aria-pressed={picked === hueOf(i)}
              style={{ x: colX(i), background: `hsl(${hueOf(i)} 60% 62%)` }}
              initial={false}
              animate={{ y: rowY(i), scale: scaleNear(i, hovered) }}
              whileHover={{ y: rowY(i) - 3 }}
              whileTap={{ scale: 0.9 }}
              onHoverStart={() => setHovered(i)}
              onTap={() => setPicked(hueOf(i))}
            />
          ))}
        </div>
        <p className="sample-note">{picked === undefined ? "Tap a swatch" : `Picked: hue ${picked}°`}</p>
      </div>
    </LazyMotion>
  )
}
