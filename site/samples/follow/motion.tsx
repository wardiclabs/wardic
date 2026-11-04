import { motion, useMotionValue, useSpring } from "motion/react"
import type { PointerEvent } from "react"

/** A dot that follows the pointer: the pointer sets two motion values, and two springs follow them. */
export default function Follow() {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 300, damping: 20 })
  const springY = useSpring(y, { stiffness: 300, damping: 20 })
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    x.set(event.clientX - box.left - 20)
    y.set(event.clientY - box.top - 20)
  }
  return (
    <div className="sample-field" onPointerMove={follow}>
      <motion.div className="sample-dot" style={{ x: springX, y: springY }} />
    </div>
  )
}
