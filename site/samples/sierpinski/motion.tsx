import { domAnimation, LazyMotion } from "motion/react"
import * as m from "motion/react-m"
import { useEffect, useRef, useState } from "react"
import { framesPerSecond } from "../frames.ts"
import { colorOf, DEPTH, HEIGHT, LEAVES, leafAt, WIDTH } from "./triangle.ts"

const LEAF_INDICES: ReadonlyArray<number> = Array.from({ length: LEAVES }, (_, i) => i)
const SPRING = { type: "spring", visualDuration: 0.5, bounce: 0.25 } as const

/** Sierpiński's triangle in 2,187 leaves, a motion.div each: a new depth retargets every one. */
export default function Sierpinski() {
  const [depth, setDepth] = useState(0)
  const [moving, setMoving] = useState(false)
  const [fps, setFps] = useState<number>()
  const climb = useRef<ReturnType<typeof setInterval>>(undefined)
  // The leaves on their way: a retarget starts a leaf again without completing it, so each counts once.
  const running = useRef(new Set<number>())
  const started = (i: number) => {
    if (running.current.size === 0) setMoving(true)
    running.current.add(i)
  }
  const landed = (i: number) => {
    running.current.delete(i)
    if (running.current.size === 0) setMoving(false)
  }
  // Its entrance climbs a level every 0.7 s, to 5, until the slider takes over.
  useEffect(() => {
    let steps = 0
    climb.current = setInterval(() => {
      steps++
      setDepth(steps)
      if (steps === 5) clearInterval(climb.current)
    }, 700)
    const stopFrames = framesPerSecond(setFps)
    return () => {
      clearInterval(climb.current)
      stopFrames()
    }
  }, [])
  return (
    <LazyMotion features={domAnimation}>
      <div className="sample-stack">
        <div className="sample-sierpinski" style={{ width: WIDTH, height: HEIGHT }}>
          {LEAF_INDICES.map((i) => (
            <m.div
              key={i}
              className="sample-leaf"
              style={{ background: colorOf(i) }}
              initial={false}
              animate={leafAt(i, depth)}
              transition={SPRING}
              onAnimationStart={() => started(i)}
              onAnimationComplete={() => landed(i)}
            />
          ))}
        </div>
        <label className="sample-range">
          Depth {depth} · {(3 ** depth).toLocaleString("en")} triangles
          <input
            type="range"
            min="0"
            max={DEPTH}
            value={depth}
            onChange={(event) => {
              clearInterval(climb.current)
              setDepth(event.currentTarget.valueAsNumber)
            }}
          />
        </label>
        <p className="sample-note">
          {LEAVES.toLocaleString("en")} elements · {moving ? "Moving…" : "Ready"} · {fps ?? "–"} fps
        </p>
      </div>
    </LazyMotion>
  )
}
