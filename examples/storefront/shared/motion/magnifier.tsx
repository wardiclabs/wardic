// The magnifier in Motion (React, `motion/react`), for the page's "Coming from Motion" panel. The
// springs and transforms are the same; Motion joins the two into one `background-position` with
// `useMotionTemplate`, where Wardic maps each to a custom property and the stylesheet joins them.
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react"
import type { PointerEvent } from "react"
import { useState } from "react"

const ZOOM = 2.5
const LENS = 160

const lens = {
  rest: { opacity: 0, scale: 0.6 },
  looking: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 400, damping: 28 } },
} as const

export function Magnifier({ src }: { readonly src: string }) {
  const pointerX = useMotionValue(LENS)
  const pointerY = useMotionValue(LENS)
  const [width, setWidth] = useState(0)
  const x = useSpring(pointerX, { stiffness: 380, damping: 32 })
  const y = useSpring(pointerY, { stiffness: 380, damping: 32 })
  const insideX = useTransform(x, (at) => LENS / 2 - at * ZOOM)
  const insideY = useTransform(y, (at) => LENS / 2 - at * ZOOM)
  const backgroundPosition = useMotionTemplate`${insideX}px ${insideY}px`

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setWidth(box.width)
    pointerX.set(event.clientX - box.left)
    pointerY.set(event.clientY - box.top)
  }

  return (
    <motion.div className="magnifier-photo" initial="rest" animate="rest" whileHover="looking" whileTap="looking" onPointerMove={follow} onPointerDown={follow}>
      <img src={src} alt="The Lagoon Vase, up close" draggable={false} />
      <motion.div
        className="lens"
        variants={lens}
        style={{ x, y, backgroundPosition, backgroundImage: `url(${src})`, backgroundSize: `${width * ZOOM}px auto` }}
      />
    </motion.div>
  )
}
