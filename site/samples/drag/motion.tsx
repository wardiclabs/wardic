import { motion } from "motion/react"
import { useRef } from "react"

/** A ball held inside its arena, and one that drags across and springs back. */
export default function Drag() {
  const arena = useRef<HTMLDivElement>(null)
  return (
    <div className="sample-arena" ref={arena}>
      <motion.div className="sample-ball" drag dragConstraints={arena} dragElastic={0.2} whileDrag={{ scale: 1.15 }} />
      <motion.div className="sample-ball sample-ball-alt" drag="x" dragSnapToOrigin whileDrag={{ scale: 1.15 }} />
    </div>
  )
}
