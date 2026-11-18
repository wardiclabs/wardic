import { createWardic, domAnimation, layout } from "@wardic/solid"
import { createSignal } from "solid-js"

// This page lays out: its own Wardic instance brings `layout`, so pages that don't never load it.
const { w } = createWardic([domAnimation, layout])

/** A switch: the stylesheet moves its knob across, and `layout` animates the move. */
export default function Switch() {
  const [on, setOn] = createSignal(false)
  return (
    <button class="sample-switch" role="switch" aria-checked={on() ? "true" : "false"} aria-label="Lights" onClick={() => setOn(!on())}>
      {/* Nothing re-renders in Solid: `layoutDependency` says when to look for a move. */}
      <w.span class="sample-knob" layout layoutDependency={on()} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
    </button>
  )
}
