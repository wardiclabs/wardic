import { domMax, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useRef } from "react"

/** A ball held inside its arena, and one that drags across and springs back. */
export default function Drag() {
  const arena = useRef<HTMLDivElement>(null)
  return (
    // This page drags, so it brings `domMax`, Motion's drag and layout, itself: pages that don't never load it.
    <LazyMotion features={domMax}>
      <div className="sample-arena" ref={arena}>
        <m.div className="sample-ball" drag dragConstraints={arena} dragElastic={0.2} whileDrag={{ scale: 1.15 }} />
        <m.div className="sample-ball sample-ball-alt" drag="x" dragSnapToOrigin whileDrag={{ scale: 1.15 }} />
      </div>
    </LazyMotion>
  )
}
