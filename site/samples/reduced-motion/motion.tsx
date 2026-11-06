import { MotionConfig, useReducedMotion } from "motion/react"
import * as m from "motion/react-m"
import { useState } from "react"

const SETTINGS = ["user", "always", "never"] as const

/** One move under each setting: under reduced motion the box jumps across, and still fades. */
export default function ReducedMotion() {
  const [setting, setSetting] = useState<(typeof SETTINGS)[number]>("always")
  const [moved, setMoved] = useState(false)
  // The visitor's own setting, as their system gives it.
  const prefers = useReducedMotion()
  return (
    <div className="sample-stack">
      <div className="sample-tabs" role="group" aria-label="reducedMotion">
        {SETTINGS.map((value) => (
          <button key={value} className="sample-tab" aria-pressed={setting === value} onClick={() => setSetting(value)}>
            {value}
          </button>
        ))}
      </div>
      <button className="sample-button" onClick={() => setMoved(!moved)}>
        Move
      </button>
      <MotionConfig reducedMotion={setting}>
        {/* Motion reads the setting as an element mounts: the key mounts the box again when it changes. */}
        <m.div key={setting} className="sample-box" animate={{ x: moved ? 160 : 0, opacity: moved ? 0.4 : 1 }} transition={{ duration: 0.8, ease: "easeInOut" }}>
          box
        </m.div>
      </MotionConfig>
      <p className="sample-note">Your system {prefers ? "asks" : "doesn't ask"} for reduced motion.</p>
    </div>
  )
}
