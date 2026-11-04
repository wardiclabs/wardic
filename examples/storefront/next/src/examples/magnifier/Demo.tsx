"use client"
import { photoOf } from "@wardic/example-storefront-shared/images"
import { m, useMotionTemplate, useMotionValue, useReducedMotionConfig, useSpring, useTransform } from "motion/react"
import { type PointerEvent, useState } from "react"

const ZOOM = 2.5
const LENS = 160

// Hover or press names a variant on the photo; the lens, a child with variants, grows in under it.
const lens = {
  rest: { opacity: 0, scale: 0.6 },
  looking: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 400, damping: 28 } },
} as const

export default function Magnifier() {
  const photo = photoOf("lagoon-vase")
  // The system's setting, or the header's switch (`MotionConfig`).
  const reduced = useReducedMotionConfig()
  // Where the pointer is over the photo, from its corner, and how wide the photo is drawn.
  const pointerX = useMotionValue(LENS)
  const pointerY = useMotionValue(LENS)
  const [width, setWidth] = useState(0)
  // The lens follows the pointer on a spring: it glides after it, and settles where it stops.
  const x = useSpring(pointerX, { stiffness: 380, damping: 32 })
  const y = useSpring(pointerY, { stiffness: 380, damping: 32 })
  // The photo inside the lens, placed so its centre shows what's under the lens, ZOOM times larger,
  // joined into one `background-position`.
  const insideX = useTransform(x, (at) => LENS / 2 - at * ZOOM)
  const insideY = useTransform(y, (at) => LENS / 2 - at * ZOOM)
  const backgroundPosition = useMotionTemplate`${insideX}px ${insideY}px`

  // The lens, put over the pointer: a mouse as it moves, a finger where it presses and as it drags.
  // The photo's `touch-action: none` keeps the page from scrolling under a finger.
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const atX = event.clientX - box.left
    const atY = event.clientY - box.top
    setWidth(box.width)
    pointerX.set(atX)
    pointerY.set(atY)
    // Under reduced motion the lens doesn't glide: it's where the pointer is.
    if (reduced) {
      x.jump(atX)
      y.jump(atY)
    }
  }

  return (
    <div className="magnifier">
      <m.div className="magnifier-photo" initial="rest" animate="rest" whileHover="looking" whileTap="looking" onPointerMove={follow} onPointerDown={follow}>
        <img src={photo.large} width={photo.width} height={photo.height} alt="The Lagoon Vase, up close" draggable={false} />
        <m.div
          className="lens"
          aria-hidden="true"
          variants={lens}
          style={{ x, y, backgroundPosition, backgroundImage: `url(${photo.large})`, backgroundSize: `${width * ZOOM}px auto` }}
        />
      </m.div>
      <p className="muted">Hover over the vase to look closer, or press and drag on a phone.</p>
    </div>
  )
}
