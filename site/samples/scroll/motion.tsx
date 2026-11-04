import { motion, useScroll } from "motion/react"
import { useRef } from "react"

const LINES = [
  "The kiln is cooling.",
  "Twelve bowls went in this morning, glazed in lagoon blue.",
  "By evening the glaze has run and pooled where the walls meet the foot.",
  "Each one comes out a little different from the last.",
  "Two have crazed: fine lines all over, like ice on a pond.",
  "One cracked in the cooling, and goes on the shelf by the door.",
  "The rest are wrapped in paper and packed for the morning post.",
]

/** A panel's scroll, shown as a bar across its top: the bar is the scroll itself, with no animation of its own. */
export default function Story() {
  const panel = useRef<HTMLDivElement>(null)
  // How far the panel is scrolled, from 0 to 1. Without `container`, it's the page's.
  const { scrollYProgress } = useScroll({ container: panel })
  return (
    <div className="sample-scroller">
      <motion.div className="sample-progress" style={{ scaleX: scrollYProgress }} />
      <div className="sample-scroll" ref={panel} tabIndex={0} aria-label="From the studio">
        {LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}
