import { LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useRef, useState } from "react"

/** A ball that drags once you ask: the page fetches Motion's Features on the press, not with itself. */
export default function Shipping() {
  const [wanted, setWanted] = useState(false)
  // How long the Features took to arrive, from the press: absent until they have.
  const [arrivedIn, setArrivedIn] = useState<number>()
  const arena = useRef<HTMLDivElement>(null)
  const pressedAt = useRef(0)

  // Motion's drag comes in `domMax`, with layout: they load for the whole page.
  const loadFeatures = async () => {
    const features = (await import("./motion-features.ts")).default
    setArrivedIn(Math.round(performance.now() - pressedAt.current))
    return features
  }

  const load = () => {
    pressedAt.current = performance.now()
    setWanted(true)
  }

  let status = "No drag yet: the ball stays put."
  if (wanted) status = "Loading drag…"
  if (arrivedIn !== undefined) status = `Drag arrived in ${arrivedIn} ms.`

  return (
    <div className="sample-stack">
      <button className="sample-button" disabled={wanted} onClick={load}>
        Load drag
      </button>
      <div className="sample-arena" ref={arena}>
        {wanted ? (
          <LazyMotion features={loadFeatures}>
            <m.div className="sample-ball" drag dragConstraints={arena} whileDrag={{ scale: 1.15 }} />
          </LazyMotion>
        ) : (
          <div className="sample-ball" />
        )}
      </div>
      <p className="sample-note" aria-live="polite">
        {status}
      </p>
    </div>
  )
}
